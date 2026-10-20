const H = require('./harness');
const fs = require('fs');
const { BrowserWindow, ipcMain } = require('electron');
// Круг 2 (r1-10): навигация, window.open, проверка IPC, разрешения, надёжная запись frog.json
module.exports = async (api) => {
  const thrown = [];
  process.on('uncaughtException', (e) => { thrown.push(e.message); console.log('[main exception]', e.message); });
  await H.sleep(1500);
  if (H.phase === 'again') { H.ok(true, 'second start with broken file'); return H.done(); }

  // r1-10-01: окна не уходят со своих страниц и не открывают новые
  const S = api.openWindow('settings'); await H.sleep(1500);
  const petUrl = api.win.webContents.getURL(), setUrl = S.webContents.getURL();
  H.exec(api.win, "location.href = 'file:///etc/hostname'").catch(() => {});
  H.exec(S, "location.href = 'file:///etc/hosts'").catch(() => {});
  await H.sleep(1200);
  H.ok(api.win.webContents.getURL() === petUrl, 'frog window did not navigate: ' + api.win.webContents.getURL());
  H.ok(S.webContents.getURL() === setUrl, 'settings window did not navigate: ' + S.webContents.getURL());
  const n0 = BrowserWindow.getAllWindows().length;
  await H.within(H.exec(S, "String(window.open('about:blank'))"), 2000); await H.sleep(500);
  H.ok(BrowserWindow.getAllWindows().length === n0, 'window.open denied: windows ' + n0 + '→' + BrowserWindow.getAllWindows().length);

  // r1-10-04: имена окон и аргументы IPC проверяются
  await H.exec(S, "frogApp.open('constructor'); frogApp.open('__proto__'); frogApp.open('toString')"); await H.sleep(400);
  H.ok(thrown.length === 0, 'app:open junk names do not throw in main: ' + thrown.join(' / '));
  await H.exec(S, "for (let i = 0; i < 5; i++) frogApp.action('snooze', { kind: 'x' + i, minutes: 1 })"); await H.sleep(300);
  H.ok(Object.keys(api.pet.state.nextNag).sort().join() === 'move,water', 'snooze kinds whitelisted: ' + Object.keys(api.pet.state.nextNag));
  await H.exec(S, "frogApp.action('pause', { minutes: 'abc' })"); await H.sleep(200);
  H.ok(Number.isFinite(api.pet.state.pausedUntil), 'pause abc keeps pausedUntil finite: ' + api.pet.state.pausedUntil);
  await H.exec(S, "frogApp.action('pause', { minutes: 1e12 })"); await H.sleep(200);
  const pl = api.pet.view(Date.now()).pausedLeftMin;
  H.ok(!api.pet.view(Date.now()).paused || pl <= 24 * 60, 'pause 1e12 bounded: ' + pl);
  await H.exec(S, "frogApp.action('pause', { minutes: 0 })"); await H.sleep(200);
  await H.exec(S, "frogApp.setSetting('nagEvery', 0.0001); frogApp.setSetting('waterEvery', 1e308)"); await H.sleep(300);
  H.ok(api.settings.nagEvery >= 1 && api.settings.waterEvery <= 480, 'numeric settings bounded: nag ' + api.settings.nagEvery + ' water ' + api.settings.waterEvery);
  // отправитель не из окна приложения — игнор
  const nag = api.settings.nagEvery;
  ipcMain.emit('app:set', { sender: api.win.webContents }, 'nagEvery', 30);
  ipcMain.emit('app:set', {}, 'nagEvery', 30);
  await H.sleep(200);
  H.ok(api.settings.nagEvery === nag, 'app:set from foreign sender ignored: ' + api.settings.nagEvery);
  // обычный путь по-прежнему работает
  await H.exec(S, "frogApp.setSetting('nagEvery', 15)"); await H.sleep(200);
  H.ok(api.settings.nagEvery === 15, 'app:set from settings window works');
  const dr = api.pet.view(Date.now()).day.drinks;
  await H.exec(api.win, "frog.action('drink')"); await H.sleep(200);
  H.ok(api.pet.view(Date.now()).day.drinks === dr + 1, 'frog action from frog window works');

  // r1-10-05: веб-разрешения рендеру не нужны — все запрещены
  const perm = await H.exec(api.win, 'Notification.permission');
  const geo = await H.within(H.exec(S, "navigator.permissions.query({ name: 'geolocation' }).then((r) => r.state)"), 3000, 'timeout');
  H.ok(perm === 'denied' && geo === 'denied', 'web permissions denied: notifications ' + perm + ', geolocation ' + geo);

  // r1-10-09: запись с fsync и правами 0600
  let syncs = 0;
  const o = fs.fsyncSync;
  fs.fsyncSync = (...a) => { syncs++; return o(...a); };
  api.save();
  fs.fsyncSync = o;
  H.ok(syncs >= 1, 'save fsyncs: ' + syncs);
  const mode = fs.statSync(api.storePath()).mode & 0o777;
  H.ok(process.platform === 'win32' || mode === 0o600, 'frog.json mode ' + mode.toString(8));
  H.done();
};
