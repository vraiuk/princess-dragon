'use strict';
// Регрессия круга 4 (G4): тост ачивки и смерть.
//   node qa/findings/r4-G4.check.js [--shots DIR]
// r3-02-01 / r3-04 jade: описание каждой из 40 ачивок (achievements.js DEFS) видно целиком, тост не налезает на морду;
//                        время показа растёт с длиной текста.
// r3-08-02: белый текст ленты тоста ≥ 4.5:1 на всех kind/rarity (замер пикселей фона под текстом).
// r1-02-07: смерть + несколько тостов → облачко «🥚 Новая жаба» видно не позже ~1 с после надгробия.
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = process.env.QA_ROOT ? path.resolve(process.env.QA_ROOT) : path.resolve(__dirname, '..', '..');   // QA_ROOT — копия для «до»
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

const FACE_TOP = 120;   // макушка жабы в окне 260×320 (глаза ниже, ~134): тост не ниже этого
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function main() {
  const { DEFS } = require(path.join(ROOT, 'app', 'achievements.js'));
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/index.html?clean=1`;
  const b = await chromium.launch();
  const open = async (reduce) => {
    const p = await b.newPage({ viewport: { width: 260, height: 320 }, deviceScaleFactor: 2, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(base);
    await p.waitForTimeout(1200);
    return { p, errs };
  };
  const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, name + '.png') });

  // ---------- r3-02-01: все 40 описаний целиком ----------
  {
    const { p, errs } = await open(true);   // reduce: тост сразу на месте, без въезда
    const cut = [], low = [];
    let maxBottom = 0;
    const heights = [];
    for (const a of DEFS) {
      const r = await p.evaluate(async (a) => {
        FrogToast.clear();
        FrogToast.show(a);
        await new Promise((ok) => setTimeout(ok, 350));
        const t = document.getElementById('toast');
        const q = (s) => t.querySelector(s);
        const clipped = (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1;
        // текст описания целиком внутри карточки (не под краем и не под черепом)
        const card = q('.card').getBoundingClientRect();
        const rg = document.createRange(); rg.selectNodeContents(q('.desc'));
        const tr = rg.getBoundingClientRect();
        return { title: clipped(q('.title')), desc: clipped(q('.desc')), out: tr.bottom > card.bottom - 3 || tr.right > card.right - 2, bottom: t.getBoundingClientRect().bottom, desc0: q('.desc').textContent };
      }, a);
      heights.push([a.id, r.bottom]);
      if (r.title || r.desc || r.out || r.desc0 !== a.desc) cut.push(`${a.id}${r.title ? '(title)' : ''}${r.desc ? '(desc)' : ''}${r.out ? '(out)' : ''}`);
      maxBottom = Math.max(maxBottom, r.bottom);
      if (a.id === 'jade' || a.id === 'tech_debt' || a.id === 'gargoyle' || a.id === 'balanced') await shot(p, `toast-${a.id}`);
    }
    expect(cut.length === 0, `тост: описание всех ${DEFS.length} ачивок видно целиком (r3-02-01)`, cut.join(', '));
    expect(maxBottom <= FACE_TOP, `тост: самый высокий не ниже ${FACE_TOP}px (морда открыта)`, heights.filter((h) => h[1] > FACE_TOP).map((h) => h[0] + '=' + h[1].toFixed(1)).join(', '));
    // время показа зависит от длины текста и даёт прочитать (≈ 25 симв/с + 0.9 с на взгляд)
    const durs = await p.evaluate((defs) => (FrogToast.duration ? defs.map((a) => [a.id, (a.title + a.desc).length, FrogToast.duration(a)]) : null), DEFS);
    if (!durs) expect(false, 'тост: FrogToast.duration(a) есть', 'нет API');
    else {
      for (const [id, n, ms] of durs) if (ms < 900 + n * 40) low.push(`${id} ${ms}мс/${n}симв`);
      const short = durs.reduce((m, x) => (x[1] < m[1] ? x : m)), long = durs.reduce((m, x) => (x[1] > m[1] ? x : m));
      expect(low.length === 0, 'тост: времени хватает прочитать (0.9 с + 40 мс/символ)', low.join(', '));
      expect(long[2] > short[2], 'тост: длинный текст висит дольше короткого', `${short[0]}=${short[2]} ${long[0]}=${long[2]}`);
    }
    expect(errs.length === 0, 'тост: без ошибок консоли', errs.join(' | '));
    await p.close();
  }

  // ---------- r3-08-02: контраст ленты ----------
  {
    const { p } = await open(true);
    const worst = [];
    for (const kind of ['good', 'secret', 'bad']) {
      for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
        await p.evaluate(({ kind, rarity }) => { FrogToast.clear(); FrogToast.show({ kind, rarity, icon: '🏅', title: 'Тест', desc: 'проверка ленты: длинное описание, чтобы тост висел дольше всех кадров замера' }); }, { kind, rarity });
        await p.waitForTimeout(350);
        if (rarity === 'common') await shot(p, `ribbon-${kind}`);
        // цвет текста, затем фон под ним: текст и тень делаем прозрачными, блик и анимацию радуги не трогаем
        const info = await p.evaluate(() => {
          const r = document.querySelector('#toast .ribbon');
          const out = [];
          for (const s of r.querySelectorAll('span')) {
            // без эмодзи 🏆/🔮/💀: он цветной и цвет текста не берёт
            const tn = s.firstChild, sp = tn.textContent.indexOf(' ');
            const rg = document.createRange();
            rg.setStart(tn, sp > 0 && sp < 4 ? sp + 1 : 0); rg.setEnd(tn, tn.textContent.length);
            const b = rg.getBoundingClientRect();
            const c = getComputedStyle(s).color.match(/[\d.]+/g).map(Number);
            // полоса, где лежат буквы: без верха/низа строки (там скруглённые углы плашки)
            out.push({ x: b.left + 1, y: b.top + b.height * 0.2, w: b.width - 2, h: b.height * 0.6, c });
          }
          for (const e of [r, ...r.querySelectorAll('span')]) { e.style.color = 'transparent'; e.style.textShadow = 'none'; }
          return out;
        });
        // кадры радуги/градиента: 5 кадров через 350 мс, пока тост висит (≥ 4.2 с)
        let min = 99;
        for (let f = 0; f < 5; f++) {
          const buf = await p.screenshot({ clip: { x: 0, y: 0, width: 260, height: 40 } });
          const px = await p.evaluate(async ({ src, spans }) => {
            const img = new Image(); img.src = src; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const res = [];
            for (const s of spans) {
              const d = g.getImageData(Math.round(s.x * 2), Math.round(s.y * 2), Math.max(1, Math.round(s.w * 2)), Math.max(1, Math.round(s.h * 2))).data;
              for (let i = 0; i < d.length; i += 4 * 3) res.push([d[i], d[i + 1], d[i + 2], s.c.slice(0, 3), Math.round(s.x * 2) + ((i / 4) % Math.max(1, Math.round(s.w * 2))), Math.round(s.y * 2) + Math.floor((i / 4) / Math.max(1, Math.round(s.w * 2)))]);
            }
            return res;
          }, { src: 'data:image/png;base64,' + buf.toString('base64'), spans: info });
          for (const [r, g, bb, c] of px) min = Math.min(min, ratio([r, g, bb], c));
          await p.waitForTimeout(350);
        }
        if (min < 4.5) worst.push(`${kind}/${rarity} ${min.toFixed(2)}:1`);
        await p.evaluate(() => { for (const e of document.querySelectorAll('#toast .ribbon, #toast .ribbon span')) { e.style.color = ''; e.style.textShadow = ''; } });
      }
    }
    expect(worst.length === 0, 'лента тоста: текст ≥ 4.5:1 на любом пикселе фона (r3-08-02)', worst.join(', '));
    await p.close();
  }

  // ---------- r1-02-07: смерть + несколько тостов ----------
  for (const [cause, reduce, n] of [['stone', false, 3], ['dry', false, 4], ['stone', true, 3], ['stone', false, 0]]) {
    const { p, errs } = await open(reduce);
    const ids = ['jade', 'gargoyle', 'tech_debt', 'vobla', 'speedrun'].slice(0, n);
    const r = await p.evaluate(async ({ cause, ids, defs }) => {
      __frogDebug.view({ life: 'dead', cause, generation: 3, ageMin: 190 });
      __frogDebug.event({ type: 'death', cause, generation: 3, ageMin: 190, text: 'x' });
      for (const id of ids) __frogDebug.event(Object.assign({ type: 'achievement' }, defs.find((d) => d.id === id)));
      const t0 = performance.now();
      let up = 0, egg = 0;
      const seen = new Set();
      while (performance.now() - t0 < 16000) {
        await new Promise((ok) => setTimeout(ok, 40));
        const t = (performance.now() - t0) / 1000;
        const st = FrogDeath.stats();
        if (!up && st.tombUp >= 1) up = t;
        const tt = document.querySelector('#toast .title');
        const tst = document.getElementById('toast');
        if (tt && tst.classList.contains('show')) seen.add(tt.textContent);
        const bb = document.getElementById('bubble');
        const btn = [...bb.querySelectorAll('button')].find((x) => /Новая жаба/.test(x.textContent));
        if (!egg && btn && !bb.classList.contains('hidden') && !bb.classList.contains('under-toast') && getComputedStyle(bb).opacity > 0.9) { egg = t; break; }
      }
      return { up, egg, seen: [...seen] };
    }, { cause, ids, defs: DEFS });
    const tag = `смерть ${cause}${reduce ? ' (reduce)' : ''} + ${n} тост.`;
    if (SHOTS && n === 3 && !reduce) await shot(p, `death-${cause}-egg`);
    expect(r.up > 0 && r.egg > 0 && r.egg - r.up <= 1.0, `${tag}: «🥚 Новая жаба» не позже 1 с после надгробия (r1-02-07)`, `tomb=${r.up.toFixed(2)} egg=${r.egg.toFixed(2)}`);
    expect(r.seen.length >= Math.min(n, reduce ? 1 : 2), `${tag}: тосты смерти показаны (${r.seen.length}/${n})`, r.seen.join(', '));
    expect(errs.length === 0, `${tag}: без ошибок консоли`, errs.join(' | '));
    await p.close();
  }

  // ---------- после надгробия тост снова живёт обычное время ----------
  {
    const { p } = await open(false);
    const ms = await p.evaluate(async (a) => {
      FrogDeath.setDead('stone', { generation: 2 });
      FrogToast.show(a);
      const t0 = performance.now();
      while (document.getElementById('toast').classList.contains('show') && performance.now() - t0 < 12000) await new Promise((ok) => setTimeout(ok, 50));
      return performance.now() - t0;
    }, DEFS.find((d) => d.id === 'necro_poke'));
    expect(ms > 2500, 'тост у готового надгробия (тык мёртвой жабы) висит обычное время', `${ms.toFixed(0)} мс`);
    await p.close();
  }

  await b.close();
  srv.close();
  for (const o of oks) console.log('ok  ' + o);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`\n${oks.length} ok, ${fails.length} fail`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
