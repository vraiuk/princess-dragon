const H = require('./harness');
const path = require('path');
const { screen } = require('electron');
// Круг 4 (G2): находки r3-07 (падения рендера, экраны, съёмка), r3-06-05 и «Позже» (уведомления),
// r1-05-10 (текст уведомления о смерти), r3-10-01 (поток IPC), r3-10-02 (права копий frog.json)
const MIN = 60000;
const alive = (w) => !!w && !w.isDestroyed() && !w.webContents.isCrashed();
const crash = (w) => {
  const gone = new Promise((r) => w.webContents.once('render-process-gone', () => r(true)));
  w.webContents.forcefullyCrashRenderer();
  return H.within(gone, 10000, false);
};
const probe = (w, js, fallback) => (alive(w) ? H.within(H.exec(w, js).catch(() => fallback), 2000, fallback) : Promise.resolve(fallback));
// рендер окна жабы снова отвечает и мост на месте
const recovered = async (w, ms = 25000) => {
  let b = '';
  await H.until(async () => (b = await probe(w, 'typeof window.frog', 'x')) === 'object', ms, 200);
  return b === 'object';
};
const reminds = (sent) => sent.filter(([ch, p]) => ch === 'event' && p && p.type === 'remind').map(([, p]) => p);
const isNag = (n) => /Пора/.test(n);

async function crashPhase(api) {
  const W = api.win;
  await H.until(() => W.isVisible(), 20000);
  const wa = screen.getPrimaryDisplay().workArea;

  // r3-07-01: рендер упал посреди перетаскивания — drag сбрасывается, окно не приклеено к курсору
  await H.exec(W, 'frog.dragStart()'); await H.sleep(200);
  H.ok(await crash(W), 'renderer crashed during drag');
  H.ok(await recovered(W), 'renderer recovered after crash in drag');
  W.setPosition(wa.x + 100, wa.y + 100); await H.sleep(400);
  const p = W.getPosition();
  H.ok(p[0] === wa.x + 100 && p[1] === wa.y + 100, 'after crash in drag window stays where put: ' + JSON.stringify(p));

  // r3-07-02: после перезагрузки рендера окно снова пропускает клики (новый рендер начинает с ignore=true)
  const ign = [];
  const o = W.setIgnoreMouseEvents.bind(W);
  W.setIgnoreMouseEvents = (...a) => { ign.push(a[0]); return o(...a); };
  await H.exec(W, 'frog.setIgnore(false)'); await H.sleep(300);
  H.ok(ign.length === 1 && ign[0] === false, 'ignore IPC applied after crash-in-drag: ' + JSON.stringify(ign));
  H.ok(await crash(W), 'renderer crashed while cursor over frog');
  H.ok(await recovered(W), 'renderer recovered');
  await H.sleep(300);
  H.ok(ign.length > 1 && ign[ign.length - 1] === true, 'window click-through again after reload: ' + JSON.stringify(ign));

  // r3-07-03: после 4 падений за минуту main сдаётся — но в трее есть путь восстановления
  const t = H.trayMenu(api);
  for (let i = 0; i < 2; i++) { await crash(W); await recovered(W); await H.sleep(300); }
  await crash(W); await H.sleep(1500);   // четвёртое за минуту: больше не поднимаем
  H.ok(!alive(W), 'gave up after 4 crashes');
  H.ok(!W.isDestroyed() ? !W.isVisible() : true, 'dead window not left on top: visible=' + (!W.isDestroyed() && W.isVisible()));
  const items = t.__menu ? t.__menu.items : [];
  const restart = items.find((i) => /Перезапустить жабу/.test(i.label));
  H.ok(!!restart, 'tray has restart item: ' + items.map((i) => i.label).filter(Boolean).join(' | '));
  if (restart) restart.click();
  await H.until(() => alive(api.win) && api.win !== W, 5000);
  H.ok(await recovered(api.win), 'frog window restarted from tray');
  H.ok(await H.until(() => api.win.isVisible(), 5000), 'restarted window visible');
  const items2 = t.__menu ? t.__menu.items : [];
  H.ok(!items2.some((i) => /Перезапустить жабу/.test(i.label)), 'restart item gone when frog is alive');
  // «Показать» тоже поднимает упавшее окно
  const W2 = api.win;
  for (let i = 0; i < 3; i++) { await crash(W2); await recovered(W2); await H.sleep(300); }
  await crash(W2); await H.sleep(1500);
  H.ok(!alive(W2), 'gave up again');
  const corner = (t.__menu ? t.__menu.items : []).find((i) => /Вернуть жабу/.test(i.label));
  if (corner) corner.click();
  await H.until(() => alive(api.win), 5000);
  H.ok(await recovered(api.win), '"return to corner" also restarts dead frog');
  H.done();
}

// два эмулированных монитора: A 1920x1080 и B 1280x720 слева
async function screensPhase(api) {
  const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 25, width: 1920, height: 1055 }, scaleFactor: 1 };
  const B = { id: 2, bounds: { x: -1280, y: 200, width: 1280, height: 720 }, workArea: { x: -1280, y: 200, width: 1280, height: 720 }, scaleFactor: 2 };
  let displays = [A, B], primary = A;
  const ov = (r, d) => Math.max(0, Math.min(r.x + r.width, d.workArea.x + d.workArea.width) - Math.max(r.x, d.workArea.x))
    * Math.max(0, Math.min(r.y + r.height, d.workArea.y + d.workArea.height) - Math.max(r.y, d.workArea.y));
  const inWA = (b, d) => b.x >= d.workArea.x && b.y >= d.workArea.y && b.x + b.width <= d.workArea.x + d.workArea.width && b.y + b.height <= d.workArea.y + d.workArea.height;
  screen.getAllDisplays = () => displays.slice();
  screen.getPrimaryDisplay = () => primary;
  screen.getDisplayMatching = (r) => displays.slice().sort((p, q) => ov(r, q) - ov(r, p))[0];
  screen.getDisplayNearestPoint = () => primary;
  const W = api.win;
  // окно на стыке A|B, центр на A; B отключили
  W.setPosition(-100, 400); await H.sleep(200);
  displays = [A]; screen.emit('display-removed', {}, B); await H.sleep(300);
  let b = W.getBounds();
  H.ok(inWA(b, A), 'B removed with frog straddling (center on A): fully on A ' + JSON.stringify(b));
  // разрешение A уменьшилось, жаба была в правом нижнем углу
  W.setPosition(1920 - 276, 1080 - 314); await H.sleep(200);
  const A2 = { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 25, width: 1280, height: 775 }, scaleFactor: 1 };
  displays = [A2]; primary = A2;
  screen.emit('display-metrics-changed', {}, A2, ['bounds', 'workArea']); await H.sleep(300);
  b = W.getBounds();
  H.ok(inWA(b, A2), 'resolution 1920x1080 -> 1280x800 keeps frog on screen ' + JSON.stringify(b));
  // рабочая область сузилась (Dock стал выше) — жаба частично под ним
  W.setPosition(1280 - 260, 800 - 320); await H.sleep(200);
  const A3 = Object.assign({}, A2, { workArea: { x: 0, y: 25, width: 1280, height: 700 } });
  displays = [A3]; primary = A3;
  screen.emit('display-metrics-changed', {}, A3, ['workArea']); await H.sleep(300);
  b = W.getBounds();
  H.ok(inWA(b, A3), 'work area shrank: frog moved inside ' + JSON.stringify(b));
  H.done();
}

async function startupPhase(api) {
  const b = api.win.getBounds();
  H.ok(H.onScreen(b), 'startup with saved pos ' + process.env.E2E_POS + ': window fully on screen ' + JSON.stringify(b));
  H.done();
}

// r3-07-05: смена сценария без ⏹ — титр старой съёмки не висит в первых кадрах новой
async function filmPhase(api) {
  const W = api.win;
  const sent = H.spySend(W);
  api.startFilm('stone');
  await H.until(() => sent.some(([ch, p]) => ch === 'event' && p.type === 'caption' && p.text), 5000);
  const old = sent.filter(([ch, p]) => ch === 'event' && p.type === 'caption' && p.text).pop()[1].text;
  await H.until(async () => (await probe(W, '!document.getElementById("caption").classList.contains("off")', false)), 3000);
  const n = sent.length;
  api.startFilm('water');
  await H.sleep(150);
  const st = JSON.parse(await H.exec(W, 'JSON.stringify([document.getElementById("caption").classList.contains("off"), document.getElementById("caption").textContent])'));
  const newCap = sent.slice(n).some(([ch, p]) => ch === 'event' && p.type === 'caption' && p.text === st[1]);
  H.ok(st[0] || st[1] !== old || newCap, 'switch film: old caption not shown over new film: ' + JSON.stringify(st) + ' old «' + old + '»');
  api.stopFilm();
  H.done();
}

// «Позже»: повтор приходит через nagEvery тихо и без системного уведомления (решение ведущего)
async function laterPhase(api) {
  const sent = H.spySend(api.win);
  const S = api.settings;
  api.pet.state.sitMs = S.moveEvery * MIN * 1.05;
  api.pet.state.nags.move = 2;                       // уже дважды проигнорировали
  api.pet.state.nextNag = { water: Date.now() + 3600000, move: Date.now() + 3600000 };
  await H.exec(api.win, "frog.action('snooze', { kind: 'move' })"); await H.sleep(300);
  const nn = api.pet.state.nextNag.move - Date.now();
  H.ok(Math.abs(nn - S.nagEvery * MIN) < 5000, 'snooze postpones by nagEvery: ' + Math.round(nn / 1000) + ' s');
  api.pet.state.nextNag.move = 0;                     // nagEvery прошёл
  await H.until(() => reminds(sent).length >= 1, 4000);
  const r = reminds(sent);
  H.ok(r.length === 1 && r[0].kind === 'move', 'repeat after «Later» arrived: ' + JSON.stringify(r.map((x) => x.kind + '#' + x.nag)));
  H.ok(r[0] && r[0].quiet === true, 'repeat after «Later» is quiet: ' + (r[0] && r[0].quiet));
  await H.sleep(300);
  H.ok(H.notes.filter(isNag).length === 0, 'no system notification on repeat after «Later»: ' + H.notes.join(' / '));
  H.done();
}

// r3-06-05: совместный тик water#1 + move#4 при видимой жабе — одно уведомление, и в нём совет разминки
async function jointPhase(api) {
  const sent = H.spySend(api.win);
  const S = api.settings;
  api.pet.state.waterMs = S.waterEvery * MIN * 1.05;
  api.pet.state.sitMs = S.moveEvery * MIN * 1.05;
  api.pet.state.nags = { water: 0, move: 3 };
  api.pet.state.nextNag = { water: 0, move: 0 };
  await H.until(() => reminds(sent).length >= 2, 4000);
  const r = reminds(sent);
  H.ok(r.map((x) => x.kind + '#' + x.nag).join() === 'water#1,move#4', 'joint tick: ' + r.map((x) => x.kind + '#' + x.nag).join());
  await H.sleep(300);
  const nags = H.notes.filter(isNag);
  H.ok(nags.length === 1, 'one notification for ignored move#4 in joint tick: ' + nags.join(' / '));
  const tip = r[1] && r[1].tip;
  H.ok(nags.length === 1 && !!tip && nags[0].includes(tip), 'notification has the exercise tip: ' + JSON.stringify(tip));
  H.ok(r.filter((x) => !x.quiet).length === 1, 'one loud reminder: ' + JSON.stringify(r.map((x) => x.quiet)));
  H.done();
}

// r1-05-10: уведомление о смерти не повторяет фразу из облачка
const words = (s) => String(s).toLowerCase().replace(/[^a-zа-яё0-9#\s]/gi, ' ').split(/\s+/).filter(Boolean);
const shingles = (s) => { const w = words(s); const out = new Set(); for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' ')); return out; };
async function deathPhase(api) {
  const Core = require(path.join(H.appRoot, 'app', 'core'));
  const sent = H.spySend(api.win);
  for (const cause of ['dry', 'stone']) {
    const n0 = H.notes.length;
    if (cause === 'dry') api.pet.state.waterMs = 10 * 3600000; else api.pet.state.sitMs = 10 * 3600000;
    await H.until(() => api.pet.view(Date.now()).life === 'dead', 5000);
    await H.sleep(300);
    const ev = sent.filter(([ch, p]) => ch === 'event' && p.type === 'death').pop();
    const note = H.notes.slice(n0).find((x) => /💀/.test(x)) || '';
    H.ok(!!ev && !!note, cause + ': death event and notification: ' + note);
    // ни одна фраза смерти из core (облачко) не совпадает с уведомлением тремя словами подряд
    const ns = shingles(note.replace(/#\d+/g, '#n'));
    const phrases = Core.PHRASES['death_' + cause].concat(ev ? [ev[1].text] : []);
    const same = [];
    phrases.forEach((ph) => shingles(ph.replace(/\{gen\}|#\d+/g, '#n')).forEach((s) => { if (ns.has(s)) same.push(s); }));
    H.ok(same.length === 0, cause + ': notification does not repeat the bubble: ' + JSON.stringify(same) + ' | ' + note);
    api.act('revive'); await H.sleep(300);
  }
  H.done();
}

// r3-10-01: поток app:set из окна настроек и action из окна жабы не вешает main надолго
async function floodPhase(api) {
  const S = api.openWindow('settings');
  await H.until(async () => (await probe(S, 'document.body.innerText.length', -1)) > 50, 20000, 200);
  const measure = async (w, js, done) => {
    let last = Date.now(), maxGap = 0;
    const iv = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 20);
    const t0 = Date.now();
    w.webContents.executeJavaScript(js).catch(() => {});
    await H.until(done, 60000, 50);
    clearInterval(iv);
    return { ms: Date.now() - t0, maxGap };
  };
  const startSound = api.settings.sound;
  let n = 0;
  api.ipcMain.on('app:set', () => { n++; });
  const r1 = await measure(S, "for (let i = 0; i < 3000; i++) frogApp.setSetting('sound', i % 2 === 0); frogApp.setSetting('waterEvery', 41)", () => n >= 3001 && api.settings.waterEvery === 41);
  console.log('[i] flood app:set', JSON.stringify(r1));
  H.ok(r1.maxGap < 1500, 'main not frozen by 3000 app:set: max event-loop gap ' + r1.maxGap + ' ms, total ' + r1.ms + ' ms');
  H.ok(api.settings.sound === false && api.settings.waterEvery === 41, 'last setting values applied: sound ' + api.settings.sound + ' (was ' + startSound + ')');
  await H.sleep(1500);
  H.ok(H.file(api).settings && H.file(api).settings.waterEvery === 41, 'settings reached frog.json');
  let d = 0;
  api.ipcMain.on('action', () => { d++; });
  const r2 = await measure(api.win, "for (let i = 0; i < 3000; i++) frog.action('dragged')", () => d >= 3000);
  console.log('[i] flood dragged', JSON.stringify(r2));
  H.ok(r2.maxGap < 1500, 'main not frozen by 3000 dragged: max gap ' + r2.maxGap + ' ms, total ' + r2.ms + ' ms');
  H.done();
}

// r3-09 (утечка меню трея): tray.setContextMenu держит каждое меню, поэтому одинаковые меню не ставим,
// а минутные подписи обновляем не каждую минуту; куча main за 2000 «минут» не растёт
async function menuPhase(api) {
  const v8 = require('v8'), vm = require('vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const heap = async () => { for (let i = 0; i < 3; i++) { gc(); await H.sleep(50); } return process.memoryUsage().heapUsed / 1e6; };
  const t = H.trayMenu(api);
  let sets = 0;
  const o = t.setContextMenu;
  t.setContextMenu = (m) => { sets++; return o(m); };
  const realNow = Date.now;
  let off = 0;
  const minute = () => { off += MIN; api.pet.state.sitMs += MIN; api.pet.state.waterMs += MIN; api.pet.state.day.codingMs += MIN; };
  // одинаковое меню 500 раз подряд (force, как после каждого действия)
  for (let i = 0; i < 500; i++) api.rebuildMenu(true);
  H.ok(sets <= 1, 'identical menu not re-set: ' + sets + ' setContextMenu for 500 forced rebuilds');
  // 30 минут сидения: меняются только минуты в подписях
  api.pet.state.sitMs = 0; api.pet.state.waterMs = 0; api.act('drink'); api.act('stretch'); await H.sleep(300);
  sets = 0;
  Date.now = () => realNow() + off;
  try { for (let i = 0; i < 30; i++) { minute(); api.updateTray(); } } finally { Date.now = realNow; }
  H.ok(sets <= 5, '30 minutes of label changes: ' + sets + ' setContextMenu (≤5)');
  // наведение на значок даёт свежие минуты
  Date.now = () => realNow() + off;
  try { api.tray.emit('mouse-enter'); } finally { Date.now = realNow; }
  const lab = (t.__menu.items.find((i) => /Сидишь/.test(i.label)) || {}).label;
  H.ok(/30 мин/.test(lab || ''), 'mouse-enter refreshes minutes: ' + lab);
  // куча: 2000 обновлений трея за 200 «минут» (раз в 6 с) со сменой подписей
  const h0 = await heap();
  sets = 0;
  Date.now = () => realNow() + off;
  try {
    for (let i = 0; i < 2000; i++) {
      off += 6000; api.pet.state.day.codingMs += 6000;
      api.updateTray();
      if (i % 200 === 0) api.rebuildMenu(true);
    }
  } finally { Date.now = realNow; }
  const dh = (await heap()) - h0;
  console.log('[i] menu heap growth', dh.toFixed(2), 'MB, sets', sets);
  H.ok(sets <= 30, '200 minutes of tray updates: ' + sets + ' setContextMenu (≤30)');
  H.ok(dh < 1.5, 'main heap bounded over 2000 tray updates: +' + dh.toFixed(2) + ' MB');
  H.done();
}

async function brokenPhase(api) {
  const fs = require('fs');
  const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
  const tmp = api.storePath() + '.tmp';
  H.ok(true, 'started with broken file; stale tmp ' + (fs.existsSync(tmp) ? mode(tmp) : 'gone'));
  api.save();   // первая запись после старта: забытый .tmp с 0644 не должен стать frog.json 0644
  H.ok(mode(api.storePath()) === '600', 'frog.json after first save is 0600: ' + mode(api.storePath()));
  H.done();
}

module.exports = async (api) => {
  H.trayTitle(api);
  await H.sleep(1500);
  const ph = H.phase.replace(/-.*$/, '');
  const run = { crash: crashPhase, screens: screensPhase, startup: startupPhase, film: filmPhase, later: laterPhase, joint: jointPhase, death: deathPhase, flood: floodPhase, broken: brokenPhase, menu: menuPhase }[ph];
  if (!run) { H.ok(false, 'unknown phase ' + H.phase); return H.done(); }
  return run(api);
};
