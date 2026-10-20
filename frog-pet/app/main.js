'use strict';
const {
  app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, screen, Notification, nativeImage, dialog, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Core = require('./core');

// Модули других частей приложения — подключаем защитно: их может ещё не быть
function optional(name) {
  try { return require(name); } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') console.error(`${name}:`, e);
    return null;
  }
}
const Ach = optional('./achievements');
const Showcase = optional('./showcase');

const BASE_W = 260, BASE_H = 320;
const SETTING_KEYS = ['waterEvery', 'moveEvery', 'breakAfter', 'nagEvery', 'scale', 'sound', 'notify', 'launchAtLogin', 'deathEnabled'];
const NUM_KEYS = ['waterEvery', 'moveEvery', 'breakAfter', 'nagEvery', 'scale'];
// Границы числовых настроек (мин; scale — множитель): мусор из файла или IPC не ломает таймеры
const LIMITS = { waterEvery: [1, 480], moveEvery: [1, 480], breakAfter: [1, 120], nagEvery: [1, 240], scale: [0.5, 3] };
const clampSetting = (k, n) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
const MAX_PAUSE_MIN = 24 * 60;
const DEFAULTS = Object.assign({ deathEnabled: true }, Core.DEFAULTS);

let win = null, tray = null, pet = null, achievements = null;
let settings = Object.assign({}, DEFAULTS);
let store = {};
let hidden = false, onboarded = false;
let locked = false, lockedAt = 0;
let drag = null;
let menuStamp = '';
let quitting = false;
let film = null;              // режим съёмки: { pet, A, now, director, name, wasHidden }
const appWins = {};           // окна приложения: trophies / settings / welcome
// Отладочные хуки (автотест, снимки) — только в разработке, не в собранном приложении
const devEnv = (k) => (app.isPackaged ? '' : process.env[k] || '');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Второй экземпляр только будит первый и выходит, ничего не трогая (ни окон, ни frog.json)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// FROG_DEBUG=1 — ошибки и предупреждения из всех окон (рендер) в stderr main-процесса
if (process.env.FROG_DEBUG) {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (ev) => {
      // Electron 38: детали в объекте события; level — 'info' | 'warning' | 'error' | 'debug'
      const level = ev.level, msg = ev.message;
      if (level === 'error' || level === 'warning' || level === 2 || level === 3) {
        console.error(`[renderer ${level}] ${msg} (${ev.sourceId || ''}:${ev.lineNumber || ''})`);
      }
    });
    wc.on('render-process-gone', (_ev, d) => console.error('[renderer gone]', d && d.reason));
    wc.on('preload-error', (_ev, p, err) => console.error('[preload error]', p, err));
  });
}

// ---------- хранилище ----------
const storePath = () => path.join(app.getPath('userData'), 'frog.json');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Битые копии: только три последние, остальные удаляем (иначе копятся без ограничения)
const BROKEN_KEEP = 3;
function pruneBroken() {
  try {
    const dir = path.dirname(storePath()), base = path.basename(storePath()) + '.broken';
    const files = fs.readdirSync(dir).filter((f) => f === base || f.startsWith(base + '-'))
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.forEach(({ f }, i) => {
      if (i >= BROKEN_KEEP) fs.unlinkSync(f);
      else fs.chmodSync(f, 0o600);
    });
  } catch (e) { console.error('broken copies', e.message); }
}

function load() {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch (e) {
    // битый файл не затираем молча: оставляем копию рядом
    if (e && e.code !== 'ENOENT') {
      console.error('frog.json не читается, начинаем заново', e.message);
      // прошлую копию не затираем: вторая и дальше — с меткой времени
      const keep = fs.existsSync(storePath() + '.broken') ? `${storePath()}.broken-${Date.now()}` : storePath() + '.broken';
      try { fs.copyFileSync(storePath(), keep); fs.chmodSync(keep, 0o600); } catch { /* нечего копировать */ }
      pruneBroken();
    }
  }
  if (!isObj(data)) return {};
  if (!isObj(data.settings)) delete data.settings;
  if (!isObj(data.pet)) delete data.pet;
  return data;
}

// Только допустимые значения настроек; мусор из файла — к значениям по умолчанию
function cleanSettings(s) {
  const out = Object.assign({}, DEFAULTS);
  if (!isObj(s)) return out;
  SETTING_KEYS.forEach((k) => {
    if (!(k in s)) return;
    if (NUM_KEYS.includes(k)) {
      const n = Number(s[k]);
      if (Number.isFinite(n) && n > 0) out[k] = clampSetting(k, n);
    } else if (typeof s[k] === 'boolean') out[k] = s[k];
  });
  return out;
}

// Сохранение v1 (без life): в v1 смерти не было, и запущенная жаба умерла бы
// в первую же секунду после обновления — даём ей фору ниже зоны «при смерти»
function migratePet(saved, s) {
  if (!isObj(saved)) return null;
  const p = Object.assign({}, saved);
  // числа из файла: мусор (строка, null) превратился бы в NaN и сломал таймеры навсегда
  ['waterMs', 'sitMs', 'pausedUntil', 'lastTick', 'awayStart', 'idleSec', 'diedAt'].forEach((k) => {
    if (k in p && !Number.isFinite(p[k])) p[k] = 0;
  });
  if ('life' in saved) return p;
  const cap = (ms, every) => Math.min(Number(ms) || 0, every * 60 * 1000 * 1.2);
  p.waterMs = cap(p.waterMs, s.waterEvery);
  p.sitMs = cap(p.sitMs, s.moveEvery);
  return p;
}

let dirReady = false, saveTimer = null;
// tmp + fsync + rename: файл целый и после падения процесса, и после выключения питания
function writeStore(text) {
  if (!dirReady) { fs.mkdirSync(path.dirname(storePath()), { recursive: true }); dirReady = true; }
  const tmp = storePath() + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  // забытый .tmp от старой версии мог остаться с 0644: open его режим не меняет
  try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, storePath());
}

function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!pet) return;
  const data = {
    settings,
    pet: pet.serialize(),
    achievements: achievements && achievements.serialize ? achievements.serialize() : store.achievements || null,
    onboarded,
    pos: win && !win.isDestroyed() ? win.getPosition() : store.pos,
    hidden: film && film.wasHidden ? true : hidden,   // съёмка показывает жабу лишь на время
    moveDeclined: !!store.moveDeclined,
  };
  try {
    writeStore(JSON.stringify(data));
    store = data;
  } catch (e) {
    dirReady = false;
    console.error('save failed', e);
  }
}

// Частые действия (тыки, перетаскивания, ачивки) — одна запись на пачку
function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(save, 1000);
}

function makeAchievements(saved) {
  if (!Ach || typeof Ach.createAchievements !== 'function') return null;
  try { return Ach.createAchievements(saved || null); } catch (e) {
    console.error('achievements init failed', e);
    try { return Ach.createAchievements(null); } catch { return null; }
  }
}

// Текущая «сцена»: реальная жаба или съёмочная
const curPet = () => (film ? film.pet : pet);
const curA = () => (film ? film.A : achievements);
const curNow = () => (film ? film.now : Date.now());
const curSettings = () => (film ? film.settings : settings);

// ---------- окно с жабой ----------
function size() {
  return [Math.round(BASE_W * settings.scale), Math.round(BASE_H * settings.scale)];
}

function defaultPos(w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  // целиком в рабочей области: иначе fitPos при следующем запуске сдвинет жабу
  return [wa.x + wa.width - w - 16, wa.y + wa.height - h];
}

// Позиция окна на экранах: все четыре угла видны — оставляем как есть (можно и на стыке мониторов);
// центр на каком-то экране — двигаем в его рабочую область; иначе (монитор пропал) — null, ставим в угол
function fitPos(pos, w, h) {
  if (!Array.isArray(pos) || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
  const [x, y] = pos;
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const inside = (px, py) => areas.some((a) => px >= a.x && px <= a.x + a.width && py >= a.y && py <= a.y + a.height);
  if ([[x, y], [x + w, y], [x, y + h], [x + w, y + h]].every(([px, py]) => inside(px, py))) return pos;
  if (!inside(x + w * 0.5, y + h * 0.5)) return null;
  const b = clampToScreen({ x, y, width: w, height: h });
  return [b.x, b.y];
}

// окно живо и его рендер не упал (в упавший send только сыплет ошибками в stderr)
const alive = (w) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed() && !w.webContents.isCrashed();

function send(channel, payload) {
  if (alive(win)) win.webContents.send(channel, payload);
}

// Упал рендер окна — поднимаем его заново; если падает снова и снова, не крутим цикл (onGiveUp)
function reloadOnCrash(w, label, file, onGiveUp) {
  const crashes = [];
  w.webContents.on('render-process-gone', (_e, d) => {
    if (quitting || w.isDestroyed()) return;
    const now = Date.now();
    crashes.push(now);
    while (now - crashes[0] > 60 * 1000) crashes.shift();
    console.error(`окно ${label}: рендер упал (${d && d.reason}), ${crashes.length > 3 ? 'больше не поднимаем' : 'перезагружаем'}`);
    if (crashes.length > 3) { if (onGiveUp) onGiveUp(); return; }
    setTimeout(() => { if (!quitting && !w.isDestroyed()) w.loadFile(file); }, 500);
  });
}

// Окно целиком в рабочей области своего экрана
function clampToScreen(b) {
  const a = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, a.x), a.x + a.width - b.width);
  const y = Math.min(Math.max(b.y, a.y), a.y + a.height - b.height);
  return { x: Math.round(x), y: Math.round(y), width: b.width, height: b.height };
}

// Перетаскивание окончено (или оборвано падением рендера): таймер moveDrag больше не двигает окно
function stopDrag() {
  if (!drag) return false;
  clearInterval(drag.timer);
  drag = null;
  return true;
}

function createWindow() {
  const [w, h] = size();
  const [x, y] = fitPos(store.pos, w, h) || defaultPos(w, h);
  const me = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'Жабка',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    },
  });
  win = me;
  win.setAlwaysOnTop(true, 'floating');
  // skipTransformProcessType: без него на macOS окна и Dock моргают при смене типа процесса
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  // спрятанная жаба не рисует: с throttling Chromium останавливает rAF у скрытого окна
  if (hidden) win.webContents.setBackgroundThrottling(true);
  const page = path.join(__dirname, 'renderer', 'index.html');
  win.loadFile(page);
  // сдались после частых падений: пустое окно поверх всех не держим, в трее — «Перезапустить жабу»
  reloadOnCrash(win, 'жабы', page, () => { if (!me.isDestroyed()) me.hide(); rebuildMenu(true); });
  // рендер упал посреди перетаскивания: drag-end уже не придёт
  win.webContents.on('render-process-gone', () => { if (win === me) stopDrag(); });
  win.webContents.on('did-finish-load', () => {
    if (win !== me) return;
    // новый рендер начинает с «клики насквозь»; main должен быть в том же состоянии
    if (!drag) me.setIgnoreMouseEvents(true, { forward: true });
    me.webContents.setZoomFactor(settings.scale);
    send('settings', settings);
    send('view', curPet().view(curNow()));
  });
  win.once('ready-to-show', () => { if (!hidden && win === me) me.showInactive(); });
  // Cmd+W (меню «Окно») не должен уничтожать жабу — только прятать; закрывается она при выходе
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); setHidden(true); } });
  win.on('closed', () => { if (win === me) win = null; });
}

// Окно жабы мертво (рендер упал и больше не поднимается) — создаём его заново
function ensureWin() {
  if (quitting || alive(win)) return;
  stopDrag();
  const old = win;
  win = null;
  if (old && !old.isDestroyed()) old.destroy();
  createWindow();
  rebuildMenu(true);
}

// Окно целиком на экране после смены мониторов, разрешения или рабочей области
function keepOnScreen() {
  if (!win || win.isDestroyed() || drag) return;
  const b = win.getBounds();
  const p = fitPos([b.x, b.y], b.width, b.height);
  if (!p) return resetPosition();
  if (p[0] !== b.x || p[1] !== b.y) { win.setPosition(p[0], p[1]); saveSoon(); }
}

function resetPosition() {
  ensureWin();
  if (!win) return;
  const [w, h] = size();
  const [x, y] = defaultPos(w, h);
  win.setBounds({ x, y, width: w, height: h });
  save();
}

function applyScale() {
  if (!win) return;
  const [w, h] = size();
  const b = win.getBounds();
  // растём вверх-влево, чтобы жаба оставалась на том же месте у края экрана, но не за краем
  const nb = clampToScreen({ x: b.x + b.width - w, y: b.y + b.height - h, width: w, height: h });
  // идёт перетаскивание: сдвигаем и его якорь, иначе таймер moveDrag вернёт окно на старое место
  if (drag) { drag.wx += nb.x - b.x; drag.wy += nb.y - b.y; }
  win.setBounds(nb);
  win.webContents.setZoomFactor(settings.scale);
}

function showWin(v) {
  if (!win) return;
  win.webContents.setBackgroundThrottling(!v);
  if (v) win.showInactive(); else win.hide();
}

function setHidden(v) {
  hidden = v;
  if (film) film.wasHidden = v;   // во время съёмки — что вернуть после неё
  if (!v) ensureWin();
  if (!win) return;
  showWin(!hidden);
  rebuildMenu(true);
  save();
}

// ---------- окна приложения ----------
const APP_WINDOWS = {
  trophies: { file: 'trophies.html', width: 720, height: 560, resizable: true, title: 'Трофеи и статистика' },
  settings: { file: 'settings.html', width: 520, height: 560, resizable: false, title: 'Настройки' },
  welcome: { file: 'welcome.html', width: 560, height: 520, resizable: false, title: 'Добро пожаловать' },
};

function focusApp() {
  if (process.platform === 'darwin') { try { app.focus({ steal: true }); } catch { /* старый macOS */ } }
}

function openWindow(name) {
  const cfg = Object.prototype.hasOwnProperty.call(APP_WINDOWS, name) ? APP_WINDOWS[name] : null;
  if (!cfg) return null;
  const old = appWins[name];
  // рендер упал и не поднялся — пустое окно не показываем, создаём новое
  if (old && !old.isDestroyed() && old.webContents.isCrashed()) old.destroy();
  if (old && !old.isDestroyed()) {
    if (old.isMinimized()) old.restore();
    old.show();
    focusApp();
    old.focus();
    return old;
  }
  const file = path.join(__dirname, 'renderer', cfg.file);
  if (!fs.existsSync(file)) { console.error(`окно ${name}: нет файла ${cfg.file}`); return null; }
  const w = new BrowserWindow({
    width: cfg.width, height: cfg.height,
    minWidth: cfg.resizable ? 560 : undefined, minHeight: cfg.resizable ? 440 : undefined,
    resizable: cfg.resizable, maximizable: cfg.resizable, minimizable: true, fullscreenable: false,
    titleBarStyle: 'hiddenInset', title: cfg.title, show: false, backgroundColor: '#fffdf5',
    webPreferences: {
      preload: path.join(__dirname, 'preload-app.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  w.removeMenu();
  w.loadFile(file);
  reloadOnCrash(w, name, file);
  w.once('ready-to-show', () => { w.show(); focusApp(); w.focus(); });
  w.on('closed', () => { if (appWins[name] === w) delete appWins[name]; });
  appWins[name] = w;
  return w;
}

function appData() {
  const p = curPet(), A = curA();
  const state = p.serialize();
  let list = [];
  try { list = A && A.list ? A.list() : []; } catch (e) { console.error('achievements.list', e); }
  return {
    settings,
    view: p.view(curNow()),
    state,
    achievements: list,
    graveyard: state.graveyard || [],
    version: app.getVersion(),
    filming: film ? film.name : null,
  };
}

function pushApp() {
  const open = Object.values(appWins).filter(alive);
  if (!open.length) return;
  const data = appData();
  open.forEach((w) => w.webContents.send('app:update', data));
}

// ---------- события жабы ----------
function notify(title, body, force) {
  if (film) return; // на съёмке системные уведомления не нужны
  if ((!settings.notify && !force) || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => setHidden(false));
  n.show();
}

// длительности — одним форматтером с core (реплики, кладбище, трофеи)
const age = (min) => Core.fmtDur(min);

// Таймеры воды и разминки повторяются каждый своё nagEvery, и вместе выходит чаще.
// Громко («ква» и уведомление) — не чаще раза в nagEvery; остальные напоминания тихие (quiet)
// Системное уведомление — одно на тик: если хоть одно напоминание тика его заслуживает (жаба спрятана
// или её игнорируют, nag ≥ 2), в нём тексты всех напоминаний тика. Повтор после «Позже» (core: ev.snoozed) —
// только облачко, тихо (решение ведущего, круг 4)
let lastNagAt = -Infinity, nagNote = null;

function nagNotify(ev, batch) {
  const now = Date.now();
  if (!nagNote || now - nagNote.at > 1500 || nagNote.done) return;
  const list = (batch || [ev]).filter((e) => e && e.type === 'remind' && !e.snoozed);
  if (!list.some((e) => hidden || e.nag >= 2)) return;
  nagNote.done = true;
  const v = pet.view(now);
  const both = (v.needs && v.needs.water && v.needs.move) || (list.some((e) => e.kind === 'water') && list.some((e) => e.kind === 'move'));
  const title = both ? '💧🤸 Пора попить и размяться' : ev.kind === 'water' ? '💧 Пора попить воды' : '🤸 Пора размяться';
  notify(title, list.map((e) => (e.tip ? e.text + '\n' + e.tip : e.text)).join('\n'));
}

function handleEvent(ev, batch) {
  if (ev.type === 'remind' && !film) {
    const now = Date.now();
    // повтор после «Позже»: облачко без «ква» и без уведомления
    if (ev.snoozed) ev = Object.assign({}, ev, { quiet: true });
    else if (now - lastNagAt < settings.nagEvery * 60 * 1000 - 1500) ev = Object.assign({}, ev, { quiet: true });
    else { lastNagAt = now; nagNote = { at: now, done: false }; }
  }
  // на съёмке — фиксированные фразы сценария, как в браузерном демо
  if (film && film.director && typeof film.director.line === 'function') film.director.line(ev);
  send('event', ev);
  if (film) return;
  if (ev.type === 'remind') {
    if (!ev.snoozed) nagNotify(ev, batch);
  } else if (ev.type === 'morning' && hidden) {
    notify('🐸 Доброе утро', ev.text);
  } else if (ev.type === 'critical') {
    notify(ev.kind === 'water' ? '🥵 Жабка при смерти от жажды' : '🗿 Жабка почти камень', ev.text || 'Ещё чуть-чуть — и всё. Спаси её!');
  } else if (ev.type === 'death') {
    // своими словами: фраза смерти уже стоит в облачке (r1-05-10)
    const n = ev.generation || 1;
    const how = ev.cause === 'stone' ? 'Слишком долго без разминки — окаменела' : 'Слишком долго без воды — засохла';
    notify(`💀 RIP, Жабка #${n}`, `${how}. Прожила ${age(ev.ageMin)}.\nВ меню: 🥚 Высидеть новую жабу`);
    rebuildMenu(true);
  } else if (ev.type === 'reborn') {
    rebuildMenu(true);
  }
}

// Ачивки: проверка после тика/действия. events — события этого шага
function checkAchievements(events) {
  const A = curA();
  if (!A || typeof A.check !== 'function') return [];
  const p = curPet(), now = curNow();
  let fresh = [];
  try {
    fresh = A.check({ now, events: events || [], view: p.view(now), state: p.serialize(), settings: curSettings() }) || [];
  } catch (e) { console.error('achievements.check', e); return []; }
  const script = film && Showcase && Showcase.SCRIPTS ? Showcase.SCRIPTS[film.name] : null;
  const loud = [];
  fresh.forEach((a) => {
    if (script && Showcase.showAchievement && !Showcase.showAchievement(script, a)) return;
    send('event', Object.assign({ type: 'achievement' }, a));
    if (a.kind === 'bad' || (a.rarity && a.rarity !== 'common')) loud.push(a);
  });
  // Системные уведомления: при смерти хватит уведомления о смерти (ачивки видны тостами)
  const died = (events || []).some((e) => e && e.type === 'death');
  if (!died && loud.length && !film) queueAchNote(loud);
  if (fresh.length) { if (!film) saveSoon(); pushApp(); }
  return fresh;
}

// Несколько ачивок подряд (в одном шаге или пачкой быстрых действий) — одним уведомлением
let achNote = null;
function queueAchNote(list) {
  if (!achNote) achNote = { list: [], timer: setTimeout(flushAchNote, 1500) };
  achNote.list.push(...list);
}
function flushAchNote() {
  const loud = achNote ? achNote.list : [];
  achNote = null;
  if (loud.length === 1) {
    const a = loud[0];
    notify(a.kind === 'bad' ? `🤡 Позорная ачивка: ${a.title}` : `🏆 ${a.title}`, `${a.icon || ''} ${a.desc || ''}`.trim());
  } else if (loud.length > 1) {
    notify(`🏆 Новые ачивки: ${loud.length}`, loud.map((a) => `${a.icon || ''} ${a.title}`.trim()).join('\n'));
  }
}

function act(type, opts = {}) {
  const p = curPet(), now = curNow();
  // режиссёр съёмки «держит» вторую потребность без событий и ачивок
  if (opts.silent && film && Showcase && typeof Showcase.quiet === 'function') {
    Showcase.quiet(p, type);
    send('view', p.view(now));
    return;
  }
  let ev = null;
  const extra = [];
  if (type === 'drink') ev = p.drink(now);
  else if (type === 'stretch') ev = p.stretch(now);
  else if (type === 'snooze') {
    if (opts.kind !== 'water' && opts.kind !== 'move') return;
    const m = Number(opts.minutes);
    p.snooze(opts.kind, now, Number.isFinite(m) && m > 0 ? Math.min(m, MAX_PAUSE_MIN) : curSettings().nagEvery);
    extra.push({ type: 'snooze', kind: opts.kind });
  } else if (type === 'poke') ev = p.poke();
  else if (type === 'pause') {
    const m = Number(opts.minutes || 0);
    if (!Number.isFinite(m) || m < 0) return;
    ev = p.pause(now, Math.min(m, MAX_PAUSE_MIN));
  }
  else if (type === 'revive') {
    // только мёртвую: двойной клик по «🥚» не должен плодить поколения
    if (typeof p.revive === 'function' && p.view(now).life === 'dead') ev = p.revive(now);
    else return;
  }
  else if (type === 'dragged') extra.push({ type: 'dragged' });
  else if (type === 'openTrophies') return void openWindow('trophies');
  else if (type === 'openSettings') return void openWindow('settings');
  else return;
  if (ev) handleEvent(ev);
  checkAchievements((ev ? [ev] : []).concat(extra));
  send('view', p.view(now));
  if (!film) saveSoon();
  refreshSoon();
}

// меню и окна приложения после действия — не чаще раза в 100 мс (поток действий не вешает main)
let refreshTimer = null;
function refreshSoon() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; if (!film) rebuildMenu(true); pushApp(); }, 100);
}

function idleNow(now) {
  let idle = powerMonitor.getSystemIdleTime();
  if (locked) idle = Math.max(idle, (now - lockedAt) / 1000);
  return idle;
}

function tick() {
  if (film) return; // на съёмке время симулированное
  const now = Date.now();
  const events = pet.tick(now, idleNow(now));
  events.forEach((e) => handleEvent(e, events));
  checkAchievements(events);
  send('view', pet.view(now));
  updateTray();
  if (events.length) { save(); pushApp(); }
}

let lastCursor = { key: '', at: 0 };
const NEAR = 120;   // px вокруг окна: здесь нужны наведение и плавный взгляд
function sendCursor() {
  if (!win || hidden || !win.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const near = p.x > b.x - NEAR && p.x < b.x + b.width + NEAR && p.y > b.y - NEAR && p.y < b.y + b.height + NEAR;
  // мышь стоит на месте — шлём редко (рендеру нужно лишь погасить наведение);
  // мышь далеко от жабы — глазам хватит 4 раз в секунду, а не 20
  const key = `${p.x},${p.y},${b.x},${b.y}`, now = Date.now();
  if (key === lastCursor.key && now - lastCursor.at < (near ? 500 : 2000)) return;
  if (!near && now - lastCursor.at < 250) return;
  lastCursor = { key, at: now, near };
  send('cursor', { x: (p.x - b.x) / settings.scale, y: (p.y - b.y) / settings.scale });
}

function moveDrag() {
  if (!drag || !win) return;
  const p = screen.getCursorScreenPoint();
  win.setPosition(Math.round(drag.wx + p.x - drag.cx), Math.round(drag.wy + p.y - drag.cy));
}

// ---------- режим съёмки ----------
const FILM_STEP = 20 * 1000;
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function filmSettings() {
  // тайминги по умолчанию, чтобы сценарии шли как задумано; внешний вид — как у пользователя
  return Object.assign({}, DEFAULTS, { scale: settings.scale, sound: settings.sound, notify: false, deathEnabled: true });
}

function filmReset() {
  if (!film) return;
  film.settings = filmSettings();
  // свой генератор с постоянным зерном (как в demo.js): реплики в дубле одни и те же
  film.pet = Core.createPet(null, film.settings, film.now, seeded(1017));
  film.pet.tick(film.now, 0);
  film.A = makeAchievements(null);
  send('view', film.pet.view(film.now));
  pushApp();
}

function filmTick(dtMs, idleSec) {
  film.now += dtMs;
  const events = film.pet.tick(film.now, idleSec || 0);
  events.forEach((e) => handleEvent(e));
  checkAchievements(events);
}

const filmCtl = {
  reset() { filmReset(); },
  ff(minutes, idleSec) {
    if (!film) return;
    let left = Math.max(0, (Number(minutes) || 0) * 60 * 1000);
    while (left > 0) {
      const dt = Math.min(FILM_STEP, left);
      filmTick(dt, idleSec);
      left -= dt;
    }
    send('view', film.pet.view(film.now));
    pushApp();
  },
  action(type, opts) { if (film) act(type, opts || {}); },
  say(text) { send('event', { type: 'say', text }); },
  event(ev) { if (ev && ev.type) send('event', ev); },
  // титр поверх сцены (хук, CTA); пустой текст — убрать. Рисует окно жабы
  caption(text) { send('event', { type: 'caption', text: String(text || '') }); },
};

function startFilm(name) {
  const S = Showcase && Showcase.SCRIPTS;
  if (!S || !S[name] || typeof Showcase.createDirector !== 'function') {
    console.error(`сценарий «${name}» недоступен`);
    return;
  }
  // смена сценария без ⏹: кадр чистим как после stopFilm, иначе титр старого висит над новым
  const switching = !!film;
  stopFilm(true);
  if (switching) send('event', { type: 'filmEnd' });
  // спрятанную жабу показываем только на время съёмки
  film = { name, now: Date.now(), pet: null, A: null, settings: null, director: null, wasHidden: hidden };
  filmReset();
  if (hidden) { hidden = false; showWin(true); }
  try {
    const d = Showcase.createDirector(S[name], filmCtl);
    film.director = d;
    if (d && typeof d.onEnd === 'function') d.onEnd(() => { if (film && film.director === d) stopFilm(); });
    if (d && typeof d.start === 'function') d.start();
  } catch (e) {
    console.error('showcase', e);
    stopFilm();
    return;
  }
  updateTray();
  rebuildMenu(true);
}

function stopFilm(silent) {
  if (!film) return;
  const d = film.director, wasHidden = film.wasHidden;
  film = null;
  try { if (d && typeof d.stop === 'function') d.stop(); } catch (e) { console.error('showcase stop', e); }
  if (silent) { if (wasHidden) hidden = true; return; }
  // возвращаем реальную жабу
  send('event', { type: 'filmEnd' });
  send('view', pet.view(Date.now()));
  if (wasHidden) setHidden(true);
  updateTray();
  rebuildMenu(true);
  pushApp();
}

// ---------- меню-бар ----------
const fmtMin = (m) => Core.fmtDur(m);
function trayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  return img;
}

function updateTray() {
  if (!tray) return;
  const v = pet.view(Date.now());
  let title = '';
  if (film) title = ' 🎬';
  else if (v.life === 'dead') title = ' 💀';
  else if (v.paused) title = ' ⏸';
  else {
    if (v.needs.water) title += '💧';
    if (v.needs.move) title += '🗿';
    if (v.critical && (v.critical.water || v.critical.move)) title += '⚠️';
    if (title) title = ' ' + title;
  }
  tray.setTitle(title);
  const soon = (m) => fmtMin(Math.max(1, m));
  let tip;
  if (v.life === 'dead') tip = `Жабка #${v.generation || 1} покинула чат. Высиди новую в меню 🥚`;
  else if (v.paused) tip = `Жабка на паузе ещё ${soon(v.pausedLeftMin)}`;
  else {
    tip = `Жабка — ${v.needs.water ? 'пора пить воду' : `вода через ${soon(v.waterLeftMin)}`}, `
      + `${v.needs.move ? 'пора размяться' : `разминка через ${soon(v.moveLeftMin)}`}`;
  }
  tray.setToolTip(tip);
  rebuildMenu(false);
}

function setSetting(key, val) {
  if (!SETTING_KEYS.includes(key)) return;
  if (NUM_KEYS.includes(key)) {
    val = Number(val);
    if (!Number.isFinite(val) || val <= 0) return;
    val = clampSetting(key, val);
  } else val = !!val;
  if (settings[key] === val) return;   // то же значение: ни записи, ни перестройки меню
  settings[key] = val;
  pet.setSettings(settings);
  if (film) { film.settings.scale = settings.scale; film.settings.sound = settings.sound; }
  if (key === 'scale') applyScale();
  if (key === 'launchAtLogin') applyLogin();
  // поток app:set (тысячи сообщений) не вешает main: меню, окна и файл — одной пачкой
  settingsSoon();
  saveSoon();
}

let settingsTimer = null;
function settingsSoon() {
  if (settingsTimer) return;
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    send('settings', settings);
    send('view', curPet().view(curNow()));
    rebuildMenu(true);
    pushApp();
  }, 30);
}

const inApplications = () => {
  if (process.platform !== 'darwin') return true;
  try { return app.isInApplicationsFolder(); } catch { return true; }
};

function applyLogin() {
  if (!app.isPackaged) return;
  // из dmg / «Загрузок» путь транслоцирован — такой login item сломается после перезапуска
  if (!inApplications()) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin }); } catch (e) { console.error(e); }
}

// Упакованное приложение не в /Applications: один раз предлагаем переместить (отказ помним)
async function offerMoveToApplications() {
  if (!app.isPackaged || process.platform !== 'darwin' || inApplications() || store.moveDeclined) return;
  try {
    focusApp();
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: 'Переместить Жабку в «Программы»?',
      detail: 'Так автозапуск при входе будет работать, а macOS не будет запускать жабу из временной папки.',
      buttons: ['Переместить в Программы', 'Не сейчас'],
      defaultId: 0, cancelId: 1,
    });
    if (response === 0) {
      save();
      app.moveToApplicationsFolder(); // при успехе перезапускает приложение
    } else {
      store.moveDeclined = true;
      save();
    }
  } catch (e) { console.error('moveToApplicationsFolder', e); }
}

// Меню приложения: правка (копипаст в полях) и окно, без «Выйти» —
// Cmd+Q в окне настроек не должен закрывать жабу, выход только через меню-бар
function setAppMenu() {
  const template = [];
  if (process.platform === 'darwin') {
    template.push({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }] });
  }
  template.push({ role: 'editMenu' });
  template.push({ label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'close' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function filmMenu() {
  const S = (Showcase && Showcase.SCRIPTS) || {};
  const items = Object.keys(S).map((k) => ({
    // длительность дописываем, только если её нет в названии
    label: `${S[k].title || k}${S[k].duration && !/~\d+\s*с\)/.test(S[k].title || '') ? ` (~${Math.round(S[k].duration)} с)` : ''}`,
    type: 'radio', checked: !!film && film.name === k,
    click: () => startFilm(k),
  }));
  if (!items.length) items.push({ label: 'Сценариев пока нет', enabled: false });
  items.push({ type: 'separator' }, { label: '⏹ Остановить', enabled: !!film, click: () => stopFilm() });
  return items;
}

// tray.setContextMenu удерживает каждое переданное меню до выхода (≈20 КБ кучи main на пересборку, r3-09).
// Поэтому: одинаковое меню не ставим вовсе; если поменялись только минуты в подписях — не чаще раза
// в MENU_MINUTES_EVERY, а свежие минуты подставляем, когда курсор наводят на значок (mouse-enter, macOS)
const MENU_MINUTES_EVERY = 10 * 60 * 1000;
let menuKey = '', menuAt = 0, menuStale = false;
const menuShape = (items) => items.map((i) => [i.type || '', i.label || '', i.enabled !== false, !!i.checked, i.submenu ? menuShape(i.submenu) : 0]);

function rebuildMenu(force, fresh) {
  if (!tray) return;
  const now = Date.now();
  const v = pet.view(now);
  const dead = v.life === 'dead';
  // структура и счётчики меню; минуты до воды/разминки сюда не входят
  const stamp = [!!(v.needs && v.needs.water), !!(v.needs && v.needs.move), v.paused, v.day.drinks, v.day.breaks, hidden, v.life, v.generation, !!film, film && film.name, alive(win)].join('|');
  const min = fmtMin;
  const status = dead
    ? [
      { label: `💀 Жабка #${v.generation || 1} ${v.cause === 'stone' ? 'окаменела' : 'засохла'}`, enabled: false },
      { label: '🥚 Высидеть новую жабу', click: () => act('revive') },
    ]
    : [
      { label: v.needs.water ? '💧 Пора пить воду!' : `💧 Вода через ${min(v.waterLeftMin)}`, enabled: false },
      { label: v.needs.move ? `🗿 Сидишь ${min(v.sitMin)} — встань!` : `🧘 Сидишь ${min(v.sitMin)}, разминка через ${min(v.moveLeftMin)}`, enabled: false },
    ];
  const template = [
    ...(film ? [{ label: `🎬 Идёт съёмка: ${film.name}`, enabled: false }] : []),
    ...(alive(win) ? [] : [{ label: '🔄 Перезапустить жабу', click: () => { ensureWin(); if (hidden) setHidden(false); } }, { type: 'separator' }]),
    ...status,
    { label: `Сегодня: стаканов ${v.day.drinks}, перерывов ${v.day.breaks}, за компом ${min(v.day.coding)}`, enabled: false },
    { type: 'separator' },
    { label: 'Я попил воды 💧', click: () => act('drink') },
    { label: 'Я размялся 🤸', click: () => act('stretch') },
    { type: 'separator' },
    v.paused
      ? { label: `Снять паузу (осталось ${min(v.pausedLeftMin)})`, click: () => act('pause', { minutes: 0 }) }
      : {
        label: 'Пауза (созвон, кино)',
        submenu: [30, 60, 120, 240].map((m) => ({ label: min(m), click: () => act('pause', { minutes: m }) })),
      },
    { label: hidden ? 'Показать жабу' : 'Спрятать жабу', click: () => setHidden(!hidden) },
    { label: 'Вернуть жабу в угол экрана', click: () => { setHidden(false); resetPosition(); } },
    { type: 'separator' },
    { label: '🏆 Трофеи и статистика', click: () => openWindow('trophies') },
    { label: '⚙️ Настройки…', click: () => openWindow('settings') },
    { label: '🎬 Режим съёмки', submenu: filmMenu() },
    { type: 'separator' },
    { label: 'Выйти', role: 'quit' },
  ];
  // действия «попил/размялся/высидеть» в меню всегда про реальную жабу, а act на съёмке — про съёмочную
  if (film) template.forEach((i) => { if (i.click && /попил|размялся|Пауза|Снять паузу|Высидеть/.test(i.label)) i.enabled = false; });
  const key = JSON.stringify(menuShape(template));
  if (key === menuKey) { menuStale = false; return; }
  if (!force && !fresh && stamp === menuStamp && now - menuAt < MENU_MINUTES_EVERY) { menuStale = true; return; }
  menuKey = key; menuStamp = stamp; menuAt = now; menuStale = false;
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: проверка отправителя ----------
// Сообщение принимаем только из главного фрейма своих окон, открытых на своих страницах
const RENDERER_URL = pathToFileURL(path.join(__dirname, 'renderer') + path.sep).href;
function from(e, kind) {
  try {
    const f = e && e.senderFrame;
    if (!f || f.parent || !String(f.url).startsWith(RENDERER_URL)) return false;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    return kind === 'pet' ? w === win : Object.values(appWins).includes(w);
  } catch { return false; }
}
const pet$ = (fn) => (e, ...a) => (from(e, 'pet') ? fn(e, ...a) : undefined);
const app$ = (fn) => (e, ...a) => (from(e, 'app') ? fn(e, ...a) : undefined);

// ---------- IPC: окно жабы ----------
ipcMain.on('action', pet$((_e, msg) => act(msg && msg.type, msg || {})));
ipcMain.on('ignore', pet$((_e, v) => { if (win && !drag) win.setIgnoreMouseEvents(!!v, { forward: true }); }));
ipcMain.on('drag-start', pet$(() => {
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  clearInterval(drag && drag.timer);
  drag = { cx: p.x, cy: p.y, wx, wy, timer: setInterval(moveDrag, 16) };
}));
ipcMain.on('drag-end', pet$(() => {
  if (!drag) return;
  const moved = win && (() => { const [x, y] = win.getPosition(); return Math.abs(x - drag.wx) + Math.abs(y - drag.wy) > 4; })();
  stopDrag();
  if (moved) act('dragged');
  else saveSoon();
}));
ipcMain.handle('init', pet$(() => ({ settings, view: curPet().view(curNow()) })));

// ---------- IPC: окна приложения (preload-app.js) ----------
ipcMain.handle('app:get', app$(() => appData()));
ipcMain.on('app:set', app$((_e, key, value) => setSetting(key, value)));
ipcMain.on('app:action', app$((_e, msg) => act(msg && msg.type, msg || {})));
ipcMain.on('app:open', app$((_e, name) => openWindow(name)));
ipcMain.on('app:onboarded', app$((e) => {
  onboarded = true;
  save();
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w === appWins.welcome) w.close();
  pushApp();
}));
ipcMain.on('app:close', app$((e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w !== win) w.close();
}));

// ---------- окна не уходят со своих страниц ----------
// Брошенный файл или ссылка не уводит окно (а с ним и preload-мост) на чужую страницу; новых окон нет
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ---------- запуск ----------
app.on('second-instance', () => setHidden(false));

app.whenReady().then(() => {
  if (!gotLock) return;
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  // веб-разрешения (камера, микрофон, гео, уведомления рендера) Жабке не нужны
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  store = load();
  const firstRun = !store.settings;
  onboarded = !!store.onboarded;
  settings = cleanSettings(store.settings);
  hidden = !!store.hidden;
  pet = Core.createPet(migratePet(store.pet, settings), settings, Date.now());
  achievements = makeAchievements(store.achievements);
  if (firstRun) applyLogin();
  setAppMenu();

  createWindow();

  tray = new Tray(trayImage());
  tray.setIgnoreDoubleClickEvents(true);
  // меню вот-вот откроют: подписи с минутами должны быть свежими
  const freshMenu = () => { if (menuStale) rebuildMenu(false, true); };
  tray.on('mouse-enter', freshMenu);
  tray.on('mouse-move', freshMenu);
  rebuildMenu(true);
  updateTray();

  powerMonitor.on('lock-screen', () => { locked = true; lockedAt = Date.now(); });
  powerMonitor.on('unlock-screen', () => { locked = false; });
  powerMonitor.on('suspend', () => { save(); });
  screen.on('display-removed', keepOnScreen);
  screen.on('display-added', keepOnScreen);
  screen.on('display-metrics-changed', keepOnScreen);

  // Онбординг при первом запуске
  if ((firstRun || !onboarded) && !devEnv('FROG_SNAPSHOT') && !process.env.FROG_SHOWCASE) {
    setTimeout(() => openWindow('welcome'), 600);
  }
  if (!devEnv('FROG_SNAPSHOT') && !process.env.FROG_SHOWCASE && !devEnv('FROG_TEST_SCRIPT')) {
    setTimeout(offerMoveToApplications, 1500);
  }

  // FROG_SHOWCASE=short — сразу запустить сценарий (для записи экрана)
  if (process.env.FROG_SHOWCASE) {
    win.webContents.once('did-finish-load', () => setTimeout(() => startFilm(process.env.FROG_SHOWCASE), 800));
  }

  // FROG_SHOWCASE + FROG_SNAPSHOT=/path.png — кадры окна жабы каждые FROG_SNAPSHOT_EVERY с
  // (по умолчанию 3) в /path-NN.png, выход после конца сценария (проверка режима съёмки)
  if (devEnv('FROG_SNAPSHOT') && process.env.FROG_SHOWCASE) {
    const every = (Number(devEnv('FROG_SNAPSHOT_EVERY')) || 3) * 1000;
    let n = 0, seen = false;
    const shot = setInterval(async () => {
      if (film) seen = true;
      if (seen && !film) { clearInterval(shot); app.quit(); return; }
      if (!win || !film) return;
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(devEnv('FROG_SNAPSHOT').replace(/\.png$/, `-${String(++n).padStart(2, '0')}.png`), img.toPNG());
      } catch (e) { console.error('snapshot', e); }
    }, every);
  } else if (devEnv('FROG_SNAPSHOT')) {
    // FROG_SNAPSHOT=/path.png — снимок окна, тык, окна приложения и выход (для проверки сборки)
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(devEnv('FROG_SNAPSHOT'), img.toPNG());
      act('poke');
      setTimeout(async () => {
        fs.writeFileSync(devEnv('FROG_SNAPSHOT').replace(/\.png$/, '-poke.png'), (await win.webContents.capturePage()).toPNG());
        // проверка окон приложения: открыть и снять, если файлы уже есть
        for (const name of Object.keys(APP_WINDOWS)) {
          const w = openWindow(name);
          if (!w) continue;
          await new Promise((r) => setTimeout(r, 1200));
          try {
            fs.writeFileSync(devEnv('FROG_SNAPSHOT').replace(/\.png$/, `-${name}.png`), (await w.webContents.capturePage()).toPNG());
          } catch (e) { console.error(`snapshot ${name}`, e); }
        }
        app.quit();
      }, 800);
    }, 2500);
  }

  // FROG_TEST_SCRIPT=/path.js — автотест: module.exports = (api) => {...}, выполняется в main после загрузки окна жабы
  if (devEnv('FROG_TEST_SCRIPT')) {
    win.webContents.once('did-finish-load', () => {
      const api = {
        act, setSetting, openWindow, startFilm, stopFilm, save, load, storePath, appData, updateTray, rebuildMenu,
        appWins, APP_WINDOWS,
        get win() { return win; }, get tray() { return tray; }, get pet() { return pet; },
        get achievements() { return achievements; }, get film() { return film; }, get settings() { return settings; },
        get hidden() { return hidden; }, get onboarded() { return onboarded; }, ipcMain,
      };
      Promise.resolve().then(() => require(path.resolve(devEnv('FROG_TEST_SCRIPT')))(api))
        .catch((e) => { console.error('[test] FAIL', e); app.exit(1); });
    });
  }

  tick();
  setInterval(tick, 1000);
  setInterval(sendCursor, 50);
  setInterval(pushApp, 2000);
  setInterval(() => { if (!film) save(); }, 30 * 1000);
});

app.on('window-all-closed', () => { /* живём в меню-баре */ });
app.on('before-quit', () => { quitting = true; stopFilm(true); save(); });
