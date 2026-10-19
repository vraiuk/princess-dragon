const H = require('./harness');
const { powerMonitor } = require('electron');
// Фазы: act — действия, смерть/возрождение, окна, настройки; restart — всё это пережило перезапуск
async function restart(api) {
  await H.sleep(1500);
  const e = JSON.parse(require('fs').readFileSync(H.side('expect.json'), 'utf8'));
  const v = api.pet.view(Date.now());
  H.ok(v.generation === e.gen && v.day.drinks === e.drinks, 'state restored ' + JSON.stringify(e));
  H.ok(api.settings.scale === 1.5 && api.settings.deathEnabled === false && api.settings.waterEvery === 30 && api.settings.sound === false, 'settings restored');
  H.ok(JSON.stringify(api.win.getSize()) === '[390,480]', 'size restored ' + api.win.getSize());
  H.ok(api.win.webContents.getZoomFactor() === 1.5, 'zoom restored');
  H.done();
}

module.exports = async (api) => {
  if (H.phase === 'restart') return restart(api);
  await H.sleep(1500);
  console.log('idle', powerMonitor.getSystemIdleTime());
  const W = api.win, now = () => Date.now();
  const fa = (t, o) => H.exec(W, `frog.action(${JSON.stringify(t)}, ${JSON.stringify(o || {})})`);
  const v0 = api.pet.view(now());
  await fa('drink'); await H.sleep(200);
  let v = api.pet.view(now());
  H.ok(v.day.drinks === v0.day.drinks + 1 && v.waterRatio < 0.01, 'drink');
  api.pet.state.sitMs = 60 * 60000;
  await fa('stretch'); await H.sleep(200);
  v = api.pet.view(now());
  H.ok(v.day.breaks === v0.day.breaks + 1 && v.sitMin === 0, 'stretch');
  await fa('snooze', { kind: 'water', minutes: 7 }); await H.sleep(200);
  H.ok(Math.abs(api.pet.state.nextNag.water - (now() + 7 * 60000)) < 3000, 'snooze nextNag');
  await fa('poke'); await H.sleep(200); H.ok(true, 'poke no crash');
  await fa('pause', { minutes: 30 }); await H.sleep(200);
  v = api.pet.view(now()); H.ok(v.paused && v.pausedLeftMin === 30, 'pause 30');
  await fa('pause', { minutes: 0 }); await H.sleep(200);
  H.ok(!api.pet.view(now()).paused, 'unpause');
  const g = api.pet.view(now()).generation;
  await fa('revive'); await H.sleep(200);
  H.ok(api.pet.view(now()).generation === g, 'revive alive = noop');
  // убить
  api.pet.state.waterMs = 10 * 3600000;
  await H.sleep(1500);
  v = api.pet.view(now());
  H.ok(v.life === 'dead' && v.cause === 'dry', 'died: ' + v.life);
  await fa('revive'); await H.sleep(200);
  v = api.pet.view(now());
  H.ok(v.life === 'alive' && v.generation === g + 1, 'revive dead -> gen ' + v.generation);
  // app windows via frog window
  await fa('openTrophies'); await fa('openSettings'); await fa('openTrophies'); await H.sleep(1500);
  const wins = require('electron').BrowserWindow.getAllWindows().length;
  H.ok(api.appWins.trophies && api.appWins.settings && wins === 3 + (api.appWins.welcome ? 1 : 0), 'trophies+settings opened once, total wins ' + wins);
  const S = api.appWins.settings;
  const vals = { waterEvery: 30, moveEvery: 60, breakAfter: 3, nagEvery: 15, scale: 1.5, sound: false, notify: false, launchAtLogin: false, deathEnabled: false };
  for (const [k, val] of Object.entries(vals)) await H.exec(S, `frogApp.setSetting(${JSON.stringify(k)}, ${JSON.stringify(val)})`);
  await H.sleep(500);
  H.ok(JSON.stringify(api.win.getSize()) === '[390,480]', 'scale size ' + api.win.getSize());
  const zf = api.win.webContents.getZoomFactor(); H.ok(zf === 1.5, 'zoom ' + zf);
  for (const k of Object.keys(vals)) H.ok(api.settings[k] === vals[k], 'setting ' + k);
  // bad values
  await H.exec(S, `frogApp.setSetting('waterEvery', 'abc'); frogApp.setSetting('bogus', 1); frogApp.setSetting('scale', -1)`);
  await H.sleep(200);
  H.ok(api.settings.waterEvery === 30 && api.settings.scale === 1.5 && !('bogus' in api.settings), 'bad values rejected');
  // deathEnabled false — не умирает
  api.pet.state.waterMs = 10 * 3600000; await H.sleep(1500);
  H.ok(api.pet.view(now()).life === 'alive', 'no death with deathEnabled=false');
  api.pet.state.waterMs = 0;
  const st = JSON.stringify({ gen: api.pet.view(now()).generation, drinks: api.pet.view(now()).day.drinks });
  require('fs').writeFileSync(H.side('expect.json'), st);
  H.done();
};
