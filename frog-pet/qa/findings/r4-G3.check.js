'use strict';
// Регрессия круга 4 для окна жабы (G3): титры, облачко мысли, reduced motion, облачко важнее тоста,
// кнопка «🥚» после надгробия, тёмные обои, CSP.
//   node qa/findings/r4-G3.check.js [--shots DIR]
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
    // CSP из meta проверяем как есть: сервер своих заголовков не добавляет
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(0, '127.0.0.1', () => ok(srv));
});

const fails = [], oks = [];
const expect = (c, name, d) => (c ? oks.push(name) : fails.push(name + ': ' + (d || '')));

// все титры сценариев
const Show = require(path.join(ROOT, 'app', 'showcase.js'));
const SCRIPT_CAPS = [...new Set(Object.values(Show.SCRIPTS).flatMap((s) => (s.steps || s).filter((x) => x && x.cmd === 'caption' && x.text).map((x) => x.text)))];
// титры круга 3, которые резались многоточием (сценарии могут вернуть длинные), и стресс на длинное слово
const STRESS = ['Моя жаба умрёт, если я не пью воду и не встаю 💀', 'Жабка — питомец-программист для macOS 🐸', 'А если сидеть 2 часа — рассыпается на камушки 🪨',
  'Она напоминала каждые 45 минут. Я не слушал.', 'Отошёл от компа на 6 минут — перерыв засчитан сам 🚶', 'Ачивки: хорошие, позорные и секретные 🏆',
  'Хардкор: без воды жаба засыхает насмерть 💀', 'Встань раз в 50 минут. Жаба сама заметит.'];
const CAPS = [...new Set(SCRIPT_CAPS.concat(STRESS))];
const GLASS = { x0: 198, x1: 237, y0: 232, y1: 290 };   // стакан в координатах окна (OY=20, с обводкой)
const TOMB_UP = 6.6;                                       // надгробие поднято (r2-F5)

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/index.html?clean=1`;
  const b = await chromium.launch();
  const open = async (reduce, bg) => {
    const p = await b.newPage({ viewport: { width: 260, height: 320 }, deviceScaleFactor: 1, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(base);
    if (bg) await p.addStyleTag({ content: `html,body{background:${bg} !important}` }).catch(() => {});
    await p.waitForTimeout(1000);
    return { p, errs };
  };
  const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, name + '.png') });
  // сумма альфы холста в прямоугольнике (координаты окна, dpr 1)
  const alphaIn = (p, x, y, w, h) => p.evaluate(([x, y, w, h]) => {
    const d = document.getElementById('cv').getContext('2d').getImageData(x, y, w, h).data;
    let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s / 255;
  }, [x, y, w, h]);
  const grab = (p, x, y, w, h) => p.evaluate(([x, y, w, h]) => Array.from(document.getElementById('cv').getContext('2d').getImageData(x, y, w, h).data), [x, y, w, h]);
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 24) n++; return n; };

  // ---------- титры: каждый целиком, ≤3 строк, не над стаканом (r3-03-01, r1-04-02) ----------
  {
    const { p, errs } = await open(false);
    expect(SCRIPT_CAPS.length >= 25, `титров в сценариях найдено ${SCRIPT_CAPS.length}`);
    const bad = [];
    let i = 0;
    for (const text of CAPS) {
      const m = await p.evaluate(async (text) => {
        __frogDebug.event({ type: 'caption', text });
        await new Promise((r) => setTimeout(r, 30));
        const c = document.getElementById('caption'), cs = getComputedStyle(c), r = c.getBoundingClientRect();
        const lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        return { clip: c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1, lines: Math.round((c.clientHeight - pad) / lh), fs: parseFloat(cs.fontSize),
          r: { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom } };
      }, text);
      const g = m.r, overGlass = g.x1 > GLASS.x0 && g.x0 < GLASS.x1 && g.y1 > GLASS.y0 && g.y0 < GLASS.y1;
      if (m.clip || m.lines > 3 || m.fs < 12 || overGlass) bad.push(`${text} → ${JSON.stringify(m)}`);
      if (i++ % 6 === 0 || /умрёт|питомец|рассыпается/.test(text)) await shot(p, 'cap-' + i);
    }
    expect(bad.length === 0, `титры: все ${CAPS.length} (сценарии + длинные круга 3) целиком, ≤3 строк, шрифт ≥12px, не над стаканом`, bad.join('\n   '));
    // титр не наезжает на облачко с кнопками
    const ov = await p.evaluate(async () => {
      __frogDebug.event({ type: 'remind', kind: 'water', text: 'Попей воды, кожа сохнет!' });
      __frogDebug.event({ type: 'caption', text: 'А если сидеть 2 часа — рассыпается на камушки 🪨' });
      await new Promise((r) => setTimeout(r, 400));
      const a = document.getElementById('bubble').getBoundingClientRect(), c = document.getElementById('caption').getBoundingClientRect();
      return a.bottom > c.top && c.bottom > a.top;
    });
    await shot(p, 'cap-bubble');
    expect(!ov, 'титр не перекрывает облачко');
    expect(errs.length === 0, 'титры: без ошибок консоли', errs.join(' | '));
    await p.close();
  }

  // ---------- облачко мысли (r3-03-02, r3-03-03, r3-03-04) ----------
  const THINK = [226, 60, 12, 18];    // правый край «пилюли» мысли
  for (const reduce of [false, true]) {
    const { p } = await open(reduce);
    await p.evaluate(() => __frogDebug.view({ activity: 'thinking', needs: {}, critical: {} }));
    await p.waitForTimeout(500);
    const on = await alphaIn(p, ...THINK);
    expect(on > 20, `${reduce ? 'reduce' : 'motion'}: облачко мысли рисуется у думающей жабы (контроль)`, `alpha=${on}`);
    if (reduce) {
      const a = await grab(p, 196, 50, 40, 28); await p.waitForTimeout(450);
      const b2 = await grab(p, 196, 50, 40, 28); await p.waitForTimeout(450);
      const c = await grab(p, 196, 50, 40, 28);
      expect(diff(a, b2) + diff(b2, c) === 0, 'reduce: точки облачка мысли не бегут (r3-03-04)', `changed=${diff(a, b2)}+${diff(b2, c)}`);
    }
    // реплика без kind (как приветствие после вылупления) — мысли нет
    await p.evaluate(() => __frogDebug.event({ type: 'say', text: 'Ква! Я Жабка #4. Наушники на месте 🎧' }));
    await p.waitForTimeout(400);
    const said = await alphaIn(p, ...THINK);
    await shot(p, `think-say${reduce ? '-rm' : ''}`);
    expect(said < 2, `${reduce ? 'reduce' : 'motion'}: пока говорит облачко, мысль не торчит (r3-03-02)`, `alpha=${said}`);
    await p.evaluate(() => __frogDebug.event({ type: 'filmEnd' }));
    for (const [k, v] of [['stone', 1], ['dry', 0.95], ['dry', 0.7], ['stone', 0.7]]) {
      await p.evaluate(([k, v]) => __frogDebug.view({ activity: 'thinking', stone: 0, dry: 0, [k]: v }), [k, v]);
      await p.waitForTimeout(2600);   // сглаживание sm.* догоняет
      const a = await alphaIn(p, ...THINK);
      if (!reduce) await shot(p, `think-${k}${v}`);
      expect(a < 2, `${reduce ? 'reduce' : 'motion'}: ${k}=${v} — облачка мысли нет (r3-03-03)`, `alpha=${a}`);
    }
    await p.close();
  }

  // ---------- reduce: «при смерти» на canvas статичен (r3-08-03) ----------
  {
    const { p } = await open(true);
    await p.evaluate(() => __frogDebug.view({ activity: 'coding', critical: { water: true }, needs: { water: true }, dry: 0.9 }));
    await p.waitForTimeout(2600);
    const R = [70, 30, 120, 50];   // кольца, верх значка «!» и жар; ниже y=80 дышит макушка (это не тревога)
    const a = await grab(p, ...R); await p.waitForTimeout(370);
    const b2 = await grab(p, ...R); await p.waitForTimeout(370);
    const c = await grab(p, ...R);
    await shot(p, 'crit-reduce');
    const n = diff(a, b2) + diff(b2, c);
    expect(n < 10, 'reduce: значок «при смерти», кольца и жар не пульсируют (r3-08-03)', `changed=${n}`);
    await p.close();
  }

  // ---------- облачко «при смерти» важнее тоста (r1-02-06) ----------
  {
    const { p } = await open(false);
    const r = await p.evaluate(async () => {
      __frogDebug.view({ critical: { move: true }, needs: { move: true }, stone: 0.8 });
      FrogToast.show({ kind: 'bad', rarity: 'common', icon: '🗿', title: 'Горгулья', desc: 'Почти окаменел за работой' });
      __frogDebug.event({ type: 'critical', kind: 'move', text: 'Я почти камень! ВСТАНЬ! 🗿' });
      const out = [];
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const bb = document.getElementById('bubble'), tt = document.getElementById('toast');
        const a = bb.getBoundingClientRect(), t = tt.getBoundingClientRect();
        const toastVis = tt.classList.contains('show') && parseFloat(getComputedStyle(tt).opacity) > 0.05;
        out.push({ under: bb.classList.contains('under-toast'), op: parseFloat(getComputedStyle(bb).opacity), overlap: toastVis && a.bottom > t.top + 2 && t.bottom > a.top + 2 });
      }
      return out;
    });
    await p.waitForTimeout(100);
    await shot(p, 'crit-toast');
    const hidden = r.filter((x) => x.under || x.op < 0.9).length, ov = r.filter((x) => x.overlap).length;
    expect(hidden === 0 && ov === 0, 'crit + тост: облачко с кнопкой видно сразу, тост его не закрывает (r1-02-06)', `hidden=${hidden}/12 overlap=${ov}/12`);
    // обычное напоминание по-прежнему ждёт под тостом (не ломаем r1-03 «облачко ждёт»)
    const q = await p.evaluate(async () => {
      __frogDebug.event({ type: 'filmEnd' });
      __frogDebug.view({ critical: {}, needs: { water: true }, stone: 0 });
      FrogToast.clear();
      FrogToast.show({ kind: 'good', rarity: 'common', icon: '💧', title: 'Глоток', desc: 'Первый стакан' });
      await new Promise((r) => setTimeout(r, 1700));
      __frogDebug.event({ type: 'remind', kind: 'water', text: 'Попей воды' });
      await new Promise((r) => setTimeout(r, 200));
      return document.getElementById('bubble').classList.contains('under-toast');
    });
    expect(q, 'обычное напоминание ждёт под тостом (контроль)');
    await p.close();
  }

  // ---------- кнопка «🥚» вскоре после надгробия, даже при трёх тостах (r1-02-07) ----------
  {
    const { p } = await open(false);
    const r = await p.evaluate(async () => {
      __frogDebug.view({ life: 'dead', cause: 'stone', generation: 3, ageMin: 190 });
      __frogDebug.event({ type: 'death', cause: 'stone', generation: 3, ageMin: 190 });
      for (const t of ['Железножопая жаба', 'Нефритовая жаба', 'Speedrun any%']) FrogToast.show({ kind: 'bad', rarity: 'rare', icon: '🗿', title: t, desc: 'Позорно' });
      const t0 = performance.now();
      let up = null, btn = null;
      while (performance.now() - t0 < 14000 && btn == null) {
        await new Promise((r) => setTimeout(r, 50));
        const s = FrogDeath.stats(), el = (performance.now() - t0) / 1000;
        if (up == null && s.tombUp >= 1) up = el;
        const bb = document.getElementById('bubble'), b = bb.querySelector('button.main');
        if (b && bb.classList.contains('dead') && !bb.classList.contains('hidden') && parseFloat(getComputedStyle(bb).opacity) > 0.9) {
          const rc = b.getBoundingClientRect(), hit = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
          if (hit === b) btn = el;
        }
      }
      return { up, btn };
    });
    await shot(p, 'dead-toasts');
    expect(r.btn != null && r.btn <= Math.max(TOMB_UP, r.up || 0) + 1, 'смерть + 3 тоста: кнопка «🥚 Новая жаба» видна и кликабельна ≤1 с после надгробия (r1-02-07)', JSON.stringify(r));
    await p.close();
  }

  // ---------- тёмные обои: наушники и пар видны (r1-03-09) ----------
  {
    const { p } = await open(false, '#111');
    await p.evaluate(() => __frogDebug.view({ activity: 'coding', dry: 0.9, needs: {}, critical: {} }));
    await p.waitForTimeout(2800);
    await shot(p, 'dark-dry');
    const m = await p.evaluate(() => {
      // скриншот холста поверх #111: смешиваем вручную
      const d = document.getElementById('cv').getContext('2d').getImageData(0, 0, 260, 320).data;
      const px = (x, y) => { const i = (y * 260 + x) * 4, a = d[i + 3] / 255; return [0, 1, 2].map((k) => d[i + k] * a + 17 * (1 - a)); };
      const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const cr = (c) => (L(c) + 0.05) / (L([17, 17, 17]) + 0.05);
      // внешний край дуги наушников (радиус ~81 от центра 130,172) — самый светлый пиксель вдоль луча
      let band = 0;
      for (const ang of [1.2, 1.35, 1.65, 1.8]) {
        let best = 0;
        for (let r = 74; r <= 86; r++) best = Math.max(best, cr(px(Math.round(130 + Math.cos(Math.PI * ang) * r), Math.round(172 + Math.sin(Math.PI * ang) * r))));
        band += best / 4;
      }
      // пар над головой: столбики x=104,130,156 выше макушки
      let steam = 0;
      for (const x of [104, 130, 156]) { let best = 0; for (let y = 76; y < 98; y++) for (let dx = -4; dx <= 4; dx++) best = Math.max(best, cr(px(x + dx, y))); steam += best / 3; }
      return { band, steam };
    });
    expect(m.band >= 3, 'тёмные обои: край наушников ≥3:1 к #111 (r1-03-09)', JSON.stringify(m));
    expect(m.steam >= 3, 'тёмные обои: пар засыхания ≥3:1 к #111 (r1-03-09)', JSON.stringify(m));
    await p.close();
  }

  // ---------- подсказки кнопок: Core.fmtDur, а не сырые минуты (r1-05-05) ----------
  {
    const { p } = await open(false);
    const t = await p.evaluate(async () => {
      __frogDebug.view({ needs: { move: true }, sitMin: 110, waterLeftMin: 125, moveLeftMin: 5 });
      await new Promise((r) => setTimeout(r, 300));
      const a = document.getElementById('bMove').title;
      __frogDebug.view({ needs: {}, sitMin: 0, waterLeftMin: 125, moveLeftMin: 75 });
      await new Promise((r) => setTimeout(r, 300));
      return [a, document.getElementById('bDrink').title, document.getElementById('bMove').title, FrogCore.fmtDur(110), FrogCore.fmtDur(125), FrogCore.fmtDur(75)];
    });
    expect(t[0].includes(t[3]) && t[1].includes(t[4]) && t[2].includes(t[5]), 'подсказки кнопок через FrogCore.fmtDur', JSON.stringify(t));
    await p.close();
  }

  // ---------- CSP как в trophies.html, страница работает (r1-10-06) ----------
  {
    const html = fs.readFileSync(path.join(ROOT, 'app/renderer/index.html'), 'utf8');
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    for (const d of ["default-src 'none'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) expect(csp.includes(d), `index.html CSP: ${d} (r1-10-06)`, csp);
    const { p, errs } = await open(false);
    const r = await p.evaluate(async () => {
      let read = 'blocked';
      try { await fetch('/package.json'); read = 'READ'; } catch (e) { /* CSP */ }
      return { read, demo: !!window.FrogShowcase && !!window.__frogDebug, frames: __frogDebug.state().frames };
    });
    expect(r.read === 'blocked' && r.demo && r.frames > 5, 'CSP: fetch заблокирован, демо и жаба работают', JSON.stringify(r));
    expect(errs.filter((e) => !/package\.json|Content Security Policy.*connect-src/.test(e)).length === 0, 'CSP: без других ошибок консоли', errs.join(' | '));
    await p.close();
  }

  await b.close();
  srv.close();
  for (const o of oks) console.log('ok   ', o);
  for (const f of fails) console.log('FAIL ', f);
  console.log(`\n${oks.length} ок / ${fails.length} провалов`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
