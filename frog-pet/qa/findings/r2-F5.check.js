'use strict';
// Регрессия круга 2 для смерти, возрождения и тоста (F5): r1-03-02/04/06/08/10, r1-04-01/12, r1-08-10, r1-09-05, r1-05-14.
//   node qa/findings/r2-F5.check.js [--shots DIR]
// Окно жабы 260x320 в браузере, всё через window.__frogDebug / FrogDeath / FrogToast.
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const serve = () => new Promise((ok) => {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(0, '127.0.0.1', () => ok(srv));
});

const fails = [], oks = [];
const expect = (c, name, d) => (c ? oks.push(name) : fails.push(name + ': ' + (d || '')));

// Тайминги, которые обещаны F6 (showcase): надгробие целиком видно не позже этого, с облачком.
const TOMB_UP = { stone: 6.6, dry: 6.4 };

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/index.html?clean=1`;
  const b = await chromium.launch();
  const open = async (reduce) => {
    const p = await b.newPage({ viewport: { width: 260, height: 320 }, deviceScaleFactor: 2, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    // все AudioContext окна — чтобы проверить, что они засыпают после звука
    await p.addInitScript(() => {
      const A = window.AudioContext;
      if (!A) return;
      window.__acs = [];
      window.AudioContext = class extends A { constructor(...a) { super(...a); window.__acs.push(this); } };
    });
    await p.goto(base);
    await p.waitForTimeout(1200);
    return { p, errs };
  };
  const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, name + '.png') });

  // ---------- смерть: надгробие и облачко ----------
  for (const cause of ['stone', 'dry']) {
    const { p, errs } = await open(false);
    const log = await p.evaluate(async (c) => {
      __frogDebug.view({ life: 'dead', cause: c, generation: 3, ageMin: 190 });
      __frogDebug.event({ type: 'death', cause: c, generation: 3, ageMin: 190 });
      const t0 = performance.now(), out = [];
      while (performance.now() - t0 < 9000) {
        await new Promise((r) => setTimeout(r, 50));
        const s = FrogDeath.stats();
        const bb = document.getElementById('bubble');
        out.push({ t: (performance.now() - t0) / 1000, up: s.tombUp, bubble: !bb.classList.contains('hidden') && bb.classList.contains('dead'), pieces: s.pieces });
      }
      return out;
    }, cause);
    const up = log.find((r) => r.up >= 1), bub = log.find((r) => r.bubble);
    expect(up && up.t <= TOMB_UP[cause], `${cause}: надгробие целиком видно не позже ${TOMB_UP[cause]} с после смерти (r1-04-01)`, up ? `t=${up.t.toFixed(2)}` : 'не появилось');
    expect(bub && up && bub.t >= up.t - 0.06, `${cause}: облачко RIP не раньше, чем надгробие поднялось (r1-03-06)`, `bubble=${bub && bub.t.toFixed(2)} tomb=${up && up.t.toFixed(2)}`);
    expect(errs.length === 0, `${cause}: без ошибок консоли`, errs.join(' | '));
    if (cause === 'stone') {
      // осколки: серые и плотные, а не полупрозрачные зелёные «листья» (r1-03-08)
      const { p: q } = await open(false);
      await q.evaluate(() => { __frogDebug.view({ life: 'dead', cause: 'stone' }); __frogDebug.event({ type: 'death', cause: 'stone' }); });
      await q.waitForTimeout(2600);
      const tone = await q.evaluate(() => {
        const c = document.getElementById('cv'), g = c.getContext('2d');
        const d = g.getImageData(0, 0, c.width, Math.round(c.height * 0.55)).data;   // выше ноутбука: только летящие осколки
        let n = 0, green = 0, semi = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 10) continue;
          n++;
          if (d[i + 3] < 200) semi++;
          if (d[i + 1] - Math.max(d[i], d[i + 2]) > 6) green++;
        }
        return { n, green: green / Math.max(1, n), semi: semi / Math.max(1, n) };
      });
      await shot(q, 'stone-shards');
      expect(tone.n > 500 && tone.green < 0.08, 'stone: осколки серые, не зелёные (r1-03-08)', JSON.stringify(tone));
      await q.close();
    }
    await p.close();
  }

  // ---------- возрождение во время анимации смерти: пыль убрана (r1-04-12) ----------
  {
    const { p } = await open(false);
    await p.evaluate(() => { __frogDebug.view({ life: 'dead', cause: 'stone' }); __frogDebug.event({ type: 'death', cause: 'stone' }); });
    await p.waitForTimeout(4200);
    const s = await p.evaluate(() => { __frogDebug.view({ life: 'alive' }); __frogDebug.event({ type: 'reborn', generation: 4 }); return FrogDeath.stats(); });
    expect(s.parts === 0 && s.pieces === 0, 'reborn посреди смерти убирает пыль и камушки (r1-04-12)', JSON.stringify(s));
    await p.close();
  }

  // ---------- вылупление: морда чистая, скорлупа на столе (r1-03-02, r1-03-10) ----------
  {
    const { p } = await open(false);
    await p.evaluate(() => { __frogDebug.view({ life: 'dead', cause: 'stone' }); FrogDeath.setDead('stone', { generation: 3 }); });
    await p.waitForTimeout(300);
    const r = await p.evaluate(async () => {
      __frogDebug.view({ life: 'alive' }); __frogDebug.event({ type: 'reborn', generation: 4 });
      const t0 = performance.now();
      let face = 0, shellOut = 0, at = 0;
      while (performance.now() - t0 < 6200) {
        await new Promise((ok) => requestAnimationFrame(ok));
        const el = (performance.now() - t0) / 1000;
        for (const q of FrogDeath.parts()) {
          // морда новой жабы: глаза и рот (координаты окна)
          if (el > 4.2 && el < 5.4 && q.a > 0.15 && ['heart', 'dust', 'spark', 'ring', 'bubble'].includes(q.kind) && q.x > 92 && q.x < 168 && q.y > 120 && q.y < 196) { face++; at = el; }
          if (q.kind === 'shell' && q.a > 0.15 && (q.y > 296 || q.x < 30 || q.x > 230)) shellOut++;
        }
      }
      return { face, shellOut, at };
    });
    expect(r.face === 0, 'вылупление: сердечки, дым и искры не на морде (r1-03-02)', JSON.stringify(r));
    expect(r.shellOut === 0, 'вылупление: скорлупа не падает ниже стола и к краю окна (r1-03-10)', JSON.stringify(r));
    await p.close();
  }

  // ---------- тост: лента, чип редкости, череп (r1-03-04, r1-05-14) ----------
  {
    const { p } = await open(false);
    for (const [kind, rarity] of [['bad', 'common'], ['bad', 'legendary'], ['good', 'legendary'], ['secret', 'epic'], ['bad', 'epic']]) {
      await p.evaluate(() => FrogToast.clear());
      await p.evaluate((a) => FrogToast.show(a), { kind, rarity, title: 'Пустыня Сахара в кружке', desc: 'Не пил воду так долго, что это уже довольно серьёзное достижение', icon: '🏜️' });
      await p.waitForTimeout(1500);
      const m = await p.evaluate(() => {
        const R = (s) => document.querySelector('#toast ' + s).getBoundingClientRect();
        const rib = R('.ribbon'), rar = R('.rar'), lab = R('.ribbon span'), sk = R('.skull');
        const rarEl = document.querySelector('#toast .rar');
        const rg = document.createRange(); rg.selectNodeContents(document.querySelector('#toast .desc'));
        const txt = [...rg.getClientRects()];
        const skullOn = getComputedStyle(document.querySelector('#toast .skull')).opacity > 0.05;
        const hit = skullOn && txt.some((t) => t.right > sk.left + 2 && t.left < sk.right && t.bottom > sk.top + 2 && t.top < sk.bottom);
        return { rarIn: rar.left >= rib.left + 4 && rar.right <= rib.right - 4 && lab.left >= rib.left + 4, rarFit: rarEl.scrollWidth <= rarEl.clientWidth, rarText: rarEl.textContent, hit };
      });
      await shot(p, `toast-${kind}-${rarity}`);
      expect(m.rarIn && m.rarFit, `тост ${kind}/${rarity}: лента и чип редкости целиком внутри (r1-03-04)`, JSON.stringify(m));
      expect(!m.hit, `тост ${kind}/${rarity}: череп не под текстом описания (r1-03-04)`, JSON.stringify(m));
      if (rarity === 'legendary') expect(m.rarText === 'легендарная', 'тост: редкость «легендарная», как в трофеях (r1-05-14)', m.rarText);
    }
    // звук: после тоста аудиоконтекст засыпает (r1-09-05)
    const st = await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 4500)); return (window.__acs || []).map((a) => a.state); });
    expect(st.length > 0 && st.every((s) => s !== 'running'), 'тост: AudioContext засыпает после звука (r1-09-05)', JSON.stringify(st));
    await p.close();
  }

  // ---------- prefers-reduced-motion (r1-08-10) ----------
  {
    const { p, errs } = await open(true);
    await p.evaluate(() => FrogToast.show({ kind: 'good', rarity: 'legendary', title: 'Тест', desc: 'конфетти' }));
    await p.waitForTimeout(400);
    const conf = await p.evaluate(() => {
      const c = document.getElementById('toast-fx'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
      const inf = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#toast') && a.effect.getTiming().iterations === Infinity).length;
      return { n, inf };
    });
    expect(conf.n === 0, 'reduce: тост без конфетти', `pixels=${conf.n}`);
    expect(conf.inf === 0, 'reduce: в тосте нет бесконечных анимаций', `infinite=${conf.inf}`);
    await p.evaluate(() => FrogToast.clear());
    const r = await p.evaluate(async () => {
      __frogDebug.view({ life: 'dead', cause: 'stone', generation: 3 });
      __frogDebug.event({ type: 'death', cause: 'stone', generation: 3 });
      const t0 = performance.now();
      let shake = 0, pieces = 0, parts = 0, up = 0;
      while (performance.now() - t0 < 4000) {
        await new Promise((ok) => requestAnimationFrame(ok));
        const fx = FrogDeath.frogFx(performance.now() / 1000);
        if (fx && fx.shake) shake = Math.max(shake, fx.shake);
        const s = FrogDeath.stats();
        pieces = Math.max(pieces, s.pieces); parts = Math.max(parts, s.parts);
        if (!up && s.tombUp >= 1) up = (performance.now() - t0) / 1000;
      }
      __frogDebug.view({ life: 'alive' }); __frogDebug.event({ type: 'reborn', generation: 4 });
      let hparts = 0, hshake = 0;
      const t1 = performance.now();
      while (performance.now() - t1 < 4000) {
        await new Promise((ok) => requestAnimationFrame(ok));
        hparts = Math.max(hparts, FrogDeath.stats().parts);
      }
      return { shake, pieces, parts, up, hparts, mode: FrogDeath.mode };
    });
    expect(r.shake === 0 && r.pieces === 0 && r.parts <= 12, 'reduce: смерть без тряски, осколков и вихря частиц', JSON.stringify(r));
    expect(r.up > 0 && r.up <= 3, 'reduce: надгробие спокойно появляется за ≤3 с', JSON.stringify(r));
    expect(r.hparts <= 12 && r.mode === 'none', 'reduce: вылупление без салюта, жаба жива', JSON.stringify(r));
    expect(errs.length === 0, 'reduce: без ошибок консоли', errs.join(' | '));
    await shot(p, 'reduce-after');
    await p.close();
  }

  await b.close();
  srv.close();
  for (const o of oks) console.log('ok   ' + o);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`\n${oks.length} ok, ${fails.length} fail`);
  process.exitCode = fails.length ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(2); });
