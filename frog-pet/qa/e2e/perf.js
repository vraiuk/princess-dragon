const H = require('./harness');
const fs = require('fs');
const { screen, app } = require('electron');
// Круг 2 (r1-09): спрятанная жаба не рисует, курсор вдали от жабы не шлётся 20 раз в секунду, frog.json не пишется на каждый тык
const RAF = 'new Promise((r) => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => r(n), 1500); })';

module.exports = async (api) => {
  await H.sleep(1500);
  // r1-09-06: курсор далеко от жабы и двигается
  const sent = H.spySend(api.win);
  const real = screen.getCursorScreenPoint;
  let i = 0;
  screen.getCursorScreenPoint = () => ({ x: 20 + (i++ % 200), y: 20 });
  const from = sent.length;
  await H.sleep(2000);
  const far = sent.slice(from).filter(([ch]) => ch === 'cursor').length;
  H.ok(far <= 10, 'cursor IPC while mouse moves far away, 2 s: ' + far);
  // рядом с жабой — как раньше, плавно
  const b = api.win.getBounds();
  screen.getCursorScreenPoint = () => ({ x: b.x + 40 + (i++ % 100), y: b.y + 100 });
  const from2 = sent.length;
  await H.sleep(2000);
  const near = sent.slice(from2).filter(([ch]) => ch === 'cursor').length;
  H.ok(near >= 25, 'cursor IPC near the frog, 2 s: ' + near);
  screen.getCursorScreenPoint = real;

  // r1-09-07: пачка тыков — не пачка записей frog.json (и без mkdir на каждую)
  let writes = 0, mkdirs = 0;
  const ren = fs.renameSync, mk = fs.mkdirSync;
  fs.renameSync = (a, c) => { if (String(c) === api.storePath()) writes++; return ren(a, c); };
  fs.mkdirSync = (...a) => { mkdirs++; return mk(...a); };
  await H.exec(api.win, "for (let i = 0; i < 30; i++) frog.action('poke')");
  await H.sleep(2500);
  fs.renameSync = ren; fs.mkdirSync = mk;
  H.ok(writes >= 1 && writes <= 3, '30 pokes → frog.json writes: ' + writes);
  H.ok(mkdirs <= 1, 'mkdir calls: ' + mkdirs);

  // r1-09-01: спрятанная жаба не крутит requestAnimationFrame
  const shown = await H.exec(api.win, RAF);
  api.win.close(); await H.sleep(1000);
  H.ok(api.hidden && !api.win.isVisible(), 'hidden');
  const hid = await H.within(H.exec(api.win, RAF), 6000, -1);
  H.ok(hid >= 0 && hid <= 5, `rAF while hidden, 1.5 s: ${hid} (shown: ${shown})`);
  app.emit('second-instance'); await H.sleep(1000);
  const back = await H.exec(api.win, RAF);
  H.ok(!api.hidden && back >= 30, 'rAF resumes after show: ' + back);
  H.done();
};
