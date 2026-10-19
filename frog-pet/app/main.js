'use strict';
const {
  app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, screen, Notification, nativeImage, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
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
const DEFAULTS = Object.assign({ deathEnabled: true }, Core.DEFAULTS);

let win = null, tray = null, pet = null, achievements = null;
let settings = Object.assign({}, DEFAULTS);
let store = {};
let hidden = false, onboarded = false;
let locked = false, lockedAt = 0;
let drag = null;
let menuStamp = '';
let quitting = false;
let film = null;              // режим съёмки: { pet, A, now, director, name }
const appWins = {};           // окна приложения: trophies / settings / welcome

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

function load() {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch (e) {
    // битый файл не затираем молча: оставляем копию рядом
    if (e && e.code !== 'ENOENT') {
      console.error('frog.json не читается, начинаем заново', e.message);
      try { fs.copyFileSync(storePath(), storePath() + '.broken'); } catch { /* нечего копировать */ }
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
      if (Number.isFinite(n) && n > 0) out[k] = k === 'scale' ? Math.min(3, Math.max(0.5, n)) : n;
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

function save() {
  if (!pet) return;
  const data = {
    settings,
    pet: pet.serialize(),
    achievements: achievements && achievements.serialize ? achievements.serialize() : store.achievements || null,
    onboarded,
    pos: win && !win.isDestroyed() ? win.getPosition() : store.pos,
    hidden,
    moveDeclined: !!store.moveDeclined,
  };
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    const tmp = storePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, storePath());
    store = data;
  } catch (e) {
    console.error('save failed', e);
  }
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
  return [wa.x + wa.width - w - 16, wa.y + wa.height - h + 6];
}

function validPos(pos, w, h) {
  if (!Array.isArray(pos)) return null;
  const [x, y] = pos;
  const ok = screen.getAllDisplays().some(({ workArea: a }) =>
    x + w * 0.5 >= a.x && x + w * 0.5 <= a.x + a.width && y + h * 0.5 >= a.y && y + h * 0.5 <= a.y + a.height);
  return ok ? pos : null;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const [w, h] = size();
  const [x, y] = validPos(store.pos, w, h) || defaultPos(w, h);
  win = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'Жабка',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  // skipTransformProcessType: без него на macOS окна и Dock моргают при смене типа процесса
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(settings.scale);
    send('settings', settings);
    send('view', curPet().view(curNow()));
  });
  win.once('ready-to-show', () => { if (!hidden) win.showInactive(); });
  // Cmd+W (меню «Окно») не должен уничтожать жабу — только прятать; закрывается она при выходе
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); setHidden(true); } });
  win.on('closed', () => { win = null; });
}

function resetPosition() {
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
  // растём вверх-влево, чтобы жаба оставалась на том же месте у края экрана
  win.setBounds({ x: b.x + b.width - w, y: b.y + b.height - h, width: w, height: h });
  win.webContents.setZoomFactor(settings.scale);
}

function setHidden(v) {
  hidden = v;
  if (!win) return;
  if (hidden) win.hide(); else win.showInactive();
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
  const cfg = APP_WINDOWS[name];
  if (!cfg) return null;
  const old = appWins[name];
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
  const open = Object.values(appWins).filter((w) => w && !w.isDestroyed());
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

function age(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min} мин`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  return `${Math.floor(min / 1440)} дн`;
}

function handleEvent(ev) {
  send('event', ev);
  if (film) return;
  if (ev.type === 'remind') {
    // Системное уведомление — если жаба спрятана или её игнорируют
    if (hidden || ev.nag >= 2) {
      notify(ev.kind === 'water' ? '💧 Пора попить воды' : '🤸 Пора размяться', ev.tip ? ev.text + '\n' + ev.tip : ev.text);
    }
  } else if (ev.type === 'morning' && hidden) {
    notify('🐸 Доброе утро', ev.text);
  } else if (ev.type === 'critical') {
    notify(ev.kind === 'water' ? '🥵 Жабка при смерти от жажды' : '🗿 Жабка почти камень', ev.text || 'Ещё чуть-чуть — и всё. Спаси её!');
  } else if (ev.type === 'death') {
    const n = ev.generation || 1;
    const title = ev.cause === 'stone' ? `💀 Жабка #${n} окаменела` : `💀 Жабка #${n} засохла в изюм`;
    const tail = ev.cause === 'stone'
      ? 'Теперь это памятник твоему коду. Без разминки.'
      : '404: Water Not Found. Покойся с миром.';
    notify(title, `Прожила ${age(ev.ageMin)}. ${tail}\nВ меню: 🥚 Высидеть новую жабу`);
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
  // Системные уведомления: при смерти хватит уведомления о смерти (ачивки видны тостами),
  // несколько ачивок разом — одним уведомлением, а не пачкой
  const died = (events || []).some((e) => e && e.type === 'death');
  if (!died && loud.length === 1) {
    const a = loud[0];
    notify(a.kind === 'bad' ? `🤡 Позорная ачивка: ${a.title}` : `🏆 ${a.title}`, `${a.icon || ''} ${a.desc || ''}`.trim());
  } else if (!died && loud.length > 1) {
    notify(`🏆 Новые ачивки: ${loud.length}`, loud.map((a) => `${a.icon || ''} ${a.title}`.trim()).join('\n'));
  }
  if (fresh.length) { if (!film) save(); pushApp(); }
  return fresh;
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
    p.snooze(opts.kind, now, opts.minutes || curSettings().nagEvery);
    extra.push({ type: 'snooze', kind: opts.kind });
  } else if (type === 'poke') ev = p.poke();
  else if (type === 'pause') ev = p.pause(now, opts.minutes || 0);
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
  if (!film) { rebuildMenu(true); save(); }
  pushApp();
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
  events.forEach(handleEvent);
  checkAchievements(events);
  send('view', pet.view(now));
  updateTray();
  if (events.length) { save(); pushApp(); }
}

let lastCursor = { key: '', at: 0 };
function sendCursor() {
  if (!win || hidden || !win.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  // мышь стоит на месте — шлём редко (рендеру нужно лишь погасить наведение)
  const key = `${p.x},${p.y},${b.x},${b.y}`, now = Date.now();
  if (key === lastCursor.key && now - lastCursor.at < 500) return;
  lastCursor = { key, at: now };
  send('cursor', { x: (p.x - b.x) / settings.scale, y: (p.y - b.y) / settings.scale });
}

function moveDrag() {
  if (!drag || !win) return;
  const p = screen.getCursorScreenPoint();
  win.setPosition(Math.round(drag.wx + p.x - drag.cx), Math.round(drag.wy + p.y - drag.cy));
}

// ---------- режим съёмки ----------
const FILM_STEP = 20 * 1000;

function filmSettings() {
  // тайминги по умолчанию, чтобы сценарии шли как задумано; внешний вид — как у пользователя
  return Object.assign({}, DEFAULTS, { scale: settings.scale, sound: settings.sound, notify: false, deathEnabled: true });
}

function filmReset() {
  if (!film) return;
  film.settings = filmSettings();
  film.pet = Core.createPet(null, film.settings, film.now);
  film.pet.tick(film.now, 0);
  film.A = makeAchievements(null);
  send('view', film.pet.view(film.now));
  pushApp();
}

function filmTick(dtMs, idleSec) {
  film.now += dtMs;
  const events = film.pet.tick(film.now, idleSec || 0);
  events.forEach(handleEvent);
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
};

function startFilm(name) {
  const S = Showcase && Showcase.SCRIPTS;
  if (!S || !S[name] || typeof Showcase.createDirector !== 'function') {
    console.error(`сценарий «${name}» недоступен`);
    return;
  }
  stopFilm(true);
  film = { name, now: Date.now(), pet: null, A: null, settings: null, director: null };
  filmReset();
  if (hidden) { hidden = false; if (win) win.showInactive(); }
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
  rebuildMenu(true);
}

function stopFilm(silent) {
  if (!film) return;
  const d = film.director;
  film = null;
  try { if (d && typeof d.stop === 'function') d.stop(); } catch (e) { console.error('showcase stop', e); }
  if (silent) return;
  // возвращаем реальную жабу
  send('event', { type: 'filmEnd' });
  send('view', pet.view(Date.now()));
  updateTray();
  rebuildMenu(true);
  pushApp();
}

// ---------- меню-бар ----------
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
  tray.setToolTip(v.life === 'dead'
    ? `Жабка #${v.generation || 1} покинула чат. Высиди новую в меню 🥚`
    : `Жабка — вода через ${v.waterLeftMin} мин, разминка через ${v.moveLeftMin} мин`);
  rebuildMenu(false);
}

function setSetting(key, val) {
  if (!SETTING_KEYS.includes(key)) return;
  if (NUM_KEYS.includes(key)) {
    val = Number(val);
    if (!Number.isFinite(val) || val <= 0) return;
    if (key === 'scale') val = Math.min(3, Math.max(0.5, val));
  } else val = !!val;
  settings[key] = val;
  pet.setSettings(settings);
  if (film) { film.settings.scale = settings.scale; film.settings.sound = settings.sound; }
  if (key === 'scale') applyScale();
  if (key === 'launchAtLogin') applyLogin();
  send('settings', settings);
  send('view', curPet().view(curNow()));
  rebuildMenu(true);
  save();
  pushApp();
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
    label: `${S[k].title || k}${S[k].duration ? ` (~${Math.round(S[k].duration)} с)` : ''}`,
    type: 'radio', checked: !!film && film.name === k,
    click: () => startFilm(k),
  }));
  if (!items.length) items.push({ label: 'Сценариев пока нет', enabled: false });
  items.push({ type: 'separator' }, { label: '⏹ Остановить', enabled: !!film, click: () => stopFilm() });
  return items;
}

function rebuildMenu(force) {
  if (!tray) return;
  const now = Date.now();
  const v = pet.view(now);
  const dead = v.life === 'dead';
  const stamp = [v.waterLeftMin, v.moveLeftMin, v.sitMin, v.paused, v.pausedLeftMin, v.day.drinks, v.day.breaks, hidden, v.life, !!film].join('|');
  if (!force && stamp === menuStamp) return;
  menuStamp = stamp;
  const min = (m) => (m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60 ? (m % 60) + ' мин' : ''}`.trim());
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
  // действия «попил/размялся» в меню всегда про реальную жабу
  if (film) template.forEach((i) => { if (i.click && /попил|размялся|Пауза|Снять паузу/.test(i.label)) i.enabled = false; });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: окно жабы ----------
ipcMain.on('action', (_e, msg) => act(msg && msg.type, msg || {}));
ipcMain.on('ignore', (_e, v) => { if (win && !drag) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('drag-start', () => {
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  clearInterval(drag && drag.timer);
  drag = { cx: p.x, cy: p.y, wx, wy, timer: setInterval(moveDrag, 16) };
});
ipcMain.on('drag-end', () => {
  if (!drag) return;
  clearInterval(drag.timer);
  const moved = win && (() => { const [x, y] = win.getPosition(); return Math.abs(x - drag.wx) + Math.abs(y - drag.wy) > 4; })();
  drag = null;
  if (moved) act('dragged');
  else save();
});
ipcMain.handle('init', () => ({ settings, view: curPet().view(curNow()) }));

// ---------- IPC: окна приложения (preload-app.js) ----------
ipcMain.handle('app:get', () => appData());
ipcMain.on('app:set', (_e, key, value) => setSetting(key, value));
ipcMain.on('app:action', (_e, msg) => act(msg && msg.type, msg || {}));
ipcMain.on('app:open', (_e, name) => openWindow(name));
ipcMain.on('app:onboarded', (e) => {
  onboarded = true;
  save();
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w === appWins.welcome) w.close();
  pushApp();
});
ipcMain.on('app:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w !== win) w.close();
});

// ---------- запуск ----------
app.on('second-instance', () => setHidden(false));

app.whenReady().then(() => {
  if (!gotLock) return;
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

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
  rebuildMenu(true);
  updateTray();

  powerMonitor.on('lock-screen', () => { locked = true; lockedAt = Date.now(); });
  powerMonitor.on('unlock-screen', () => { locked = false; });
  powerMonitor.on('suspend', () => { save(); });
  screen.on('display-removed', () => {
    if (!win) return;
    const b = win.getBounds();
    if (!validPos([b.x, b.y], b.width, b.height)) resetPosition();
  });

  // Онбординг при первом запуске
  if ((firstRun || !onboarded) && !process.env.FROG_SNAPSHOT && !process.env.FROG_SHOWCASE) {
    setTimeout(() => openWindow('welcome'), 600);
  }
  if (!process.env.FROG_SNAPSHOT && !process.env.FROG_SHOWCASE && !process.env.FROG_TEST_SCRIPT) {
    setTimeout(offerMoveToApplications, 1500);
  }

  // FROG_SHOWCASE=short — сразу запустить сценарий (для записи экрана)
  if (process.env.FROG_SHOWCASE) {
    win.webContents.once('did-finish-load', () => setTimeout(() => startFilm(process.env.FROG_SHOWCASE), 800));
  }

  // FROG_SHOWCASE + FROG_SNAPSHOT=/path.png — кадры окна жабы каждые FROG_SNAPSHOT_EVERY с
  // (по умолчанию 3) в /path-NN.png, выход после конца сценария (проверка режима съёмки)
  if (process.env.FROG_SNAPSHOT && process.env.FROG_SHOWCASE) {
    const every = (Number(process.env.FROG_SNAPSHOT_EVERY) || 3) * 1000;
    let n = 0, seen = false;
    const shot = setInterval(async () => {
      if (film) seen = true;
      if (seen && !film) { clearInterval(shot); app.quit(); return; }
      if (!win || !film) return;
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.FROG_SNAPSHOT.replace(/\.png$/, `-${String(++n).padStart(2, '0')}.png`), img.toPNG());
      } catch (e) { console.error('snapshot', e); }
    }, every);
  } else if (process.env.FROG_SNAPSHOT) {
    // FROG_SNAPSHOT=/path.png — снимок окна, тык, окна приложения и выход (для проверки сборки)
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.FROG_SNAPSHOT, img.toPNG());
      act('poke');
      setTimeout(async () => {
        fs.writeFileSync(process.env.FROG_SNAPSHOT.replace(/\.png$/, '-poke.png'), (await win.webContents.capturePage()).toPNG());
        // проверка окон приложения: открыть и снять, если файлы уже есть
        for (const name of Object.keys(APP_WINDOWS)) {
          const w = openWindow(name);
          if (!w) continue;
          await new Promise((r) => setTimeout(r, 1200));
          try {
            fs.writeFileSync(process.env.FROG_SNAPSHOT.replace(/\.png$/, `-${name}.png`), (await w.webContents.capturePage()).toPNG());
          } catch (e) { console.error(`snapshot ${name}`, e); }
        }
        app.quit();
      }, 800);
    }, 2500);
  }

  // FROG_TEST_SCRIPT=/path.js — автотест: module.exports = (api) => {...}, выполняется в main после загрузки окна жабы
  if (process.env.FROG_TEST_SCRIPT) {
    win.webContents.once('did-finish-load', () => {
      const api = {
        act, setSetting, openWindow, startFilm, stopFilm, save, load, storePath, appData, updateTray, rebuildMenu,
        appWins, APP_WINDOWS,
        get win() { return win; }, get tray() { return tray; }, get pet() { return pet; },
        get achievements() { return achievements; }, get film() { return film; }, get settings() { return settings; },
        get hidden() { return hidden; }, get onboarded() { return onboarded; }, ipcMain,
      };
      Promise.resolve().then(() => require(path.resolve(process.env.FROG_TEST_SCRIPT))(api))
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
