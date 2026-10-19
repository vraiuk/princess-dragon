'use strict';
const {
  app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, screen, Notification, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const Core = require('./core');

const BASE_W = 260, BASE_H = 320;

let win = null, tray = null, pet = null;
let settings = Object.assign({}, Core.DEFAULTS);
let store = {};
let hidden = false;
let locked = false, lockedAt = 0;
let drag = null;
let menuStamp = '';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- хранилище ----------
const storePath = () => path.join(app.getPath('userData'), 'frog.json');

function load() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return {}; }
}

function save() {
  if (!pet) return;
  const data = {
    settings,
    pet: pet.serialize(),
    pos: win && !win.isDestroyed() ? win.getPosition() : store.pos,
    hidden,
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(settings.scale);
    send('settings', settings);
    send('view', pet.view(Date.now()));
  });
  win.once('ready-to-show', () => { if (!hidden) win.showInactive(); });
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

// ---------- события жабы ----------
function notify(title, body) {
  if (!settings.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', () => setHidden(false));
  n.show();
}

function handleEvent(ev) {
  send('event', ev);
  if (ev.type === 'remind') {
    // Системное уведомление — если жаба спрятана или её игнорируют
    if (hidden || ev.nag >= 2) {
      notify(ev.kind === 'water' ? '💧 Пора попить воды' : '🤸 Пора размяться', ev.tip ? ev.text + '\n' + ev.tip : ev.text);
    }
  } else if (ev.type === 'morning' && hidden) {
    notify('🐸 Доброе утро', ev.text);
  }
}

function act(type, opts = {}) {
  const now = Date.now();
  let ev = null;
  if (type === 'drink') ev = pet.drink(now);
  else if (type === 'stretch') ev = pet.stretch(now);
  else if (type === 'snooze') pet.snooze(opts.kind, now, opts.minutes || settings.nagEvery);
  else if (type === 'poke') ev = pet.poke();
  else if (type === 'pause') ev = pet.pause(now, opts.minutes || 0);
  if (ev) handleEvent(ev);
  send('view', pet.view(now));
  rebuildMenu(true);
  save();
}

function tick() {
  const now = Date.now();
  let idle = powerMonitor.getSystemIdleTime();
  if (locked) idle = Math.max(idle, (now - lockedAt) / 1000);
  const events = pet.tick(now, idle);
  events.forEach(handleEvent);
  send('view', pet.view(now));
  updateTray();
  if (events.length) save();
}

function sendCursor() {
  if (!win || hidden || !win.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  send('cursor', { x: (p.x - b.x) / settings.scale, y: (p.y - b.y) / settings.scale });
}

function moveDrag() {
  if (!drag || !win) return;
  const p = screen.getCursorScreenPoint();
  win.setPosition(Math.round(drag.wx + p.x - drag.cx), Math.round(drag.wy + p.y - drag.cy));
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
  if (v.paused) title = ' ⏸';
  else {
    if (v.needs.water) title += '💧';
    if (v.needs.move) title += '🗿';
    if (title) title = ' ' + title;
  }
  tray.setTitle(title);
  tray.setToolTip(`Жабка — вода через ${v.waterLeftMin} мин, разминка через ${v.moveLeftMin} мин`);
  rebuildMenu(false);
}

function radio(label, key, values, fmt) {
  return {
    label,
    submenu: values.map((val) => ({
      label: fmt(val), type: 'radio', checked: settings[key] === val,
      click: () => setSetting(key, val),
    })),
  };
}

function setSetting(key, val) {
  settings[key] = val;
  pet.setSettings(settings);
  if (key === 'scale') applyScale();
  if (key === 'launchAtLogin') applyLogin();
  send('settings', settings);
  send('view', pet.view(Date.now()));
  rebuildMenu(true);
  save();
}

function applyLogin() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin }); } catch (e) { console.error(e); }
}

function rebuildMenu(force) {
  if (!tray) return;
  const now = Date.now();
  const v = pet.view(now);
  const stamp = [v.waterLeftMin, v.moveLeftMin, v.sitMin, v.paused, v.pausedLeftMin, v.day.drinks, v.day.breaks, hidden].join('|');
  if (!force && stamp === menuStamp) return;
  menuStamp = stamp;
  const min = (m) => (m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60 ? (m % 60) + ' мин' : ''}`.trim());
  const template = [
    { label: v.needs.water ? '💧 Пора пить воду!' : `💧 Вода через ${min(v.waterLeftMin)}`, enabled: false },
    { label: v.needs.move ? `🗿 Сидишь ${min(v.sitMin)} — встань!` : `🧘 Сидишь ${min(v.sitMin)}, разминка через ${min(v.moveLeftMin)}`, enabled: false },
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
    {
      label: 'Настройки',
      submenu: [
        radio('Пить воду каждые', 'waterEvery', [30, 45, 60, 90], (m) => min(m)),
        radio('Разминка каждые', 'moveEvery', [30, 45, 50, 60, 90], (m) => min(m)),
        radio('Перерыв засчитан после', 'breakAfter', [3, 5, 10], (m) => `${m} мин без мыши`),
        radio('Повторять напоминание', 'nagEvery', [5, 10, 15, 30], (m) => `через ${m} мин`),
        radio('Размер жабы', 'scale', [0.75, 1, 1.25, 1.5], (s) => ({ 0.75: 'Малыш', 1: 'Обычная', 1.25: 'Большая', 1.5: 'Огромная' })[s]),
        { type: 'separator' },
        { label: 'Звук «ква»', type: 'checkbox', checked: settings.sound, click: (i) => setSetting('sound', i.checked) },
        { label: 'Системные уведомления', type: 'checkbox', checked: settings.notify, click: (i) => setSetting('notify', i.checked) },
        { label: 'Запускать при входе', type: 'checkbox', checked: settings.launchAtLogin, enabled: app.isPackaged, click: (i) => setSetting('launchAtLogin', i.checked) },
      ],
    },
    { type: 'separator' },
    { label: 'Выйти', role: 'quit' },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
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
  if (drag) clearInterval(drag.timer);
  drag = null;
  save();
});
ipcMain.handle('init', () => ({ settings, view: pet.view(Date.now()) }));

// ---------- запуск ----------
app.on('second-instance', () => setHidden(false));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  store = load();
  const firstRun = !store.settings;
  settings = Object.assign({}, Core.DEFAULTS, store.settings || {});
  hidden = !!store.hidden;
  pet = Core.createPet(store.pet, settings, Date.now());
  if (firstRun) applyLogin();

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

  // FROG_SNAPSHOT=/path.png — снимок окна и выход (для проверки сборки)
  if (process.env.FROG_SNAPSHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.FROG_SNAPSHOT, img.toPNG());
      act('poke');
      setTimeout(async () => {
        fs.writeFileSync(process.env.FROG_SNAPSHOT.replace(/\.png$/, '-poke.png'), (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 800);
    }, 2500);
  }

  tick();
  setInterval(tick, 1000);
  setInterval(sendCursor, 50);
  setInterval(save, 30 * 1000);
});

app.on('window-all-closed', () => { /* живём в меню-баре */ });
app.on('before-quit', save);
