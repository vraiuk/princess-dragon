'use strict';
// R2-F8: регрессионные проверки окон «Настройки» и «Приветствие» (находки r1-08, r1-02).
//   node qa/findings/r2-F8.check.js [--shots DIR]
// Падает (exit 1) на коде до фикса и проходит после. Скриншоты: zoom 100% и 125%, светлая и тёмная тема.
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '../../app');
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

function serve() {
  const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const fails = [], oks = [];
const expect = (c, name, detail) => (c ? oks.push(name) : fails.push(`${name}: ${detail}`));

// контраст по WCAG; цвета из getComputedStyle (rgb/rgba), альфа смешивается с фоном
const CONTRAST = `(() => {
  const parse = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) st.push(c); if (c.a >= 1) break; } let bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = st.length - 1; i >= 0; i--) bg = over(st[i], bg); return bg; };
  window.__c = { parse, over, ratio, bgOf, text: (el) => { const bg = bgOf(el); return ratio(over(parse(getComputedStyle(el).color), bg), bg); } };
})()`;

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/renderer/`;
  const browser = await chromium.launch();
  const open = async (url, { zoom = 1, scheme = 'light', reduce = false, init } = {}) => {
    const W = url.startsWith('settings') ? 520 : 560, H = url.startsWith('settings') ? 560 : 520;
    // zoom 125% в Electron = окно того же размера в точках, но CSS-пикселей меньше
    const ctx = await browser.newContext({ viewport: { width: Math.round(W / zoom), height: Math.round(H / zoom) }, deviceScaleFactor: zoom, colorScheme: scheme, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    if (init) await p.addInitScript(init);
    await p.goto(base + url);
    await p.waitForTimeout(400);
    await p.evaluate(CONTRAST);
    return { p, errors, close: () => ctx.close() };
  };

  for (const scheme of ['light', 'dark']) {
    for (const zoom of [1, 1.25]) {
      const z = Math.round(zoom * 100);
      // --- приветствие: каждый слайд целиком видим или прокручивается ---
      for (let i = 0; i < 4; i++) {
        const s = await open(`welcome.html?slide=${i}`, { zoom, scheme });
        if (SHOTS) await s.p.screenshot({ path: path.join(SHOTS, `welcome-${i}-${scheme}-z${z}.png`) });
        const r = await s.p.evaluate((i) => {
          const slide = document.querySelectorAll('.slide')[i];
          const stage = document.querySelector('.stage').getBoundingClientRect();
          const scrollable = /auto|scroll/.test(getComputedStyle(slide).overflowY);
          slide.scrollTop = slide.scrollHeight;
          const hidden = [...slide.querySelectorAll('.chip, .mode, .login, p, h2')].filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > stage.bottom + 0.5 || b.top < stage.top - 0.5; }).map((el) => el.className || el.tagName);
          const fits = slide.scrollHeight <= slide.clientHeight + 1;
          slide.scrollTop = 0;
          return { hidden, fits, scrollable };
        }, i);
        expect(r.hidden.length === 0, `welcome ${i} ${scheme} z${z}: всё содержимое достижимо`, `скрыто: ${r.hidden.join(', ')} (scrollable=${r.scrollable})`);
        if (zoom === 1) expect(r.fits, `welcome ${i} ${scheme} z100: влезает без прокрутки`, 'нужна прокрутка на 100%');
        expect(s.errors.length === 0, `welcome ${i} ${scheme} z${z}: без ошибок`, s.errors.join(' | '));
        if (i === 0 || i === 3) {
          const c = await s.p.evaluate(() => ({ next: __c.text(document.getElementById('bNext')), skip: __c.text(document.getElementById('bSkip')), muted: __c.text(document.querySelector('.mode .d')) }));
          expect(c.next >= 4.5, `welcome ${i} ${scheme}: контраст «${i === 3 ? 'Поехали' : 'Дальше'}» ≥4.5`, c.next.toFixed(2));
          if (i === 0) expect(c.skip >= 4.5, `welcome ${scheme}: контраст «Пропустить» ≥4.5`, c.skip.toFixed(2));
          if (i === 3) expect(c.muted >= 4.5, `welcome ${scheme}: контраст описания режима ≥4.5`, c.muted.toFixed(2));
        }
        await s.close();
      }
      // --- настройки ---
      const s = await open('settings.html', { zoom, scheme });
      if (SHOTS) await s.p.screenshot({ path: path.join(SHOTS, `settings-${scheme}-z${z}.png`) });
      const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ov <= 0, `settings ${scheme} z${z}: без горизонтального скролла`, `${ov}px`);
      if (zoom === 1) {
        const m = await s.p.evaluate(() => Math.min(...[...document.querySelectorAll('.row-hint, .group-title, .what, .ticks span, .ver')].map(__c.text)));
        expect(m >= 4.5, `settings ${scheme}: контраст --muted ≥4.5`, m.toFixed(2));
        // кольцо фокуса: самый внешний цвет box-shadow против фона ≥3:1
        await s.p.keyboard.press('Tab');
        for (let k = 0; k < 40; k++) { if (await s.p.evaluate(() => document.activeElement.id === 'bWelcome')) break; await s.p.keyboard.press('Tab'); }
        await s.p.waitForTimeout(300); // у .btn transition на box-shadow
        if (SHOTS) await s.p.screenshot({ path: path.join(SHOTS, `settings-focus-${scheme}.png`), clip: { x: 0, y: 470, width: 520, height: 90 } });
        const ring = await s.p.evaluate(() => {
          const el = document.activeElement, cs = getComputedStyle(el);
          const bg = __c.bgOf(el.parentElement);
          const cols = (cs.boxShadow.match(/rgba?\([^)]+\)/g) || []).map(__c.parse);
          const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 ? __c.parse(cs.outlineColor) : null;
          const best = Math.max(0, ...cols.map((c) => __c.ratio(__c.over(c, bg), bg)), outline ? __c.ratio(__c.over(outline, bg), bg) : 0);
          return { id: el.id, best };
        });
        expect(ring.id === 'bWelcome' && ring.best >= 3, `settings ${scheme}: кольцо фокуса ≥3:1`, `${ring.id} ${ring.best.toFixed(2)}`);
      }
      await s.close();
    }
  }

  // --- клавиатура в приветствии ---
  {
    const s = await open('welcome.html');
    await s.p.focus('#bSkip'); await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(100);
    let a = await s.p.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    expect(a !== 'BODY' && a !== 'bSkip', 'welcome: фокус после «Пропустить» не теряется', a);
    await s.close();
  }
  {
    const s = await open('welcome.html?slide=1');
    await s.p.focus('#bBack'); await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(100);
    const a = await s.p.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    expect(a !== 'BODY' && a !== 'bBack', 'welcome: фокус после «← Назад» на первый слайд не теряется', a);
    await s.close();
  }
  {
    const s = await open('welcome.html?slide=3');
    await s.p.focus('#mHard'); await s.p.keyboard.press('ArrowLeft'); await s.p.waitForTimeout(100);
    const r = await s.p.evaluate(() => ({ soft: document.getElementById('mSoft').getAttribute('aria-checked'), a: document.activeElement.id, cur: [...document.querySelectorAll('.slide')].findIndex((x) => !x.inert), tab: [document.getElementById('mHard').tabIndex, document.getElementById('mSoft').tabIndex], dot: document.querySelector('#dots [aria-current]') && [...document.getElementById('dots').children].indexOf(document.querySelector('#dots [aria-current]')) }));
    expect(r.soft === 'true' && r.a === 'mSoft' && r.cur === 3, 'welcome: стрелки в radiogroup выбирают режим, а не листают', JSON.stringify(r));
    expect(r.tab.filter((t) => t === 0).length === 1, 'welcome: в порядке Tab одна радиокнопка (roving tabindex)', JSON.stringify(r.tab));
    expect(r.dot === 3, 'welcome: у активной точки aria-current', String(r.dot));
    await s.close();
  }
  {
    // r1-02-03: приветствие говорит, где кнопки и меню
    const s = await open('welcome.html');
    const t = await s.p.evaluate(() => document.getElementById('track').textContent.replace(/\s+/g, ' '));
    expect(/навед/i.test(t), 'welcome: сказано, что кнопки появляются при наведении', '');
    expect(/меню-бар/i.test(t), 'welcome: сказано про значок в меню-баре', '');
    expect(/Dock/.test(t), 'welcome: сказано, что иконки в Dock нет', '');
    await s.close();
  }

  // --- null в настройках ---
  const NULLS = `window.frogApp = { getData: () => Promise.resolve({ settings: { waterEvery: null, moveEvery: null, breakAfter: null, nagEvery: null, scale: null, sound: true, notify: true, launchAtLogin: true, deathEnabled: true }, view: {}, state: {}, achievements: [], graveyard: [], version: 'dev' }), onUpdate() {}, setSetting() {}, action() {}, open() {}, finishOnboarding() {}, close() {} };`;
  {
    const s = await open('settings.html', { init: NULLS });
    const r = await s.p.evaluate(() => ({ w: document.getElementById('doomWater').textContent, pressed: [...document.querySelectorAll('.seg')].map((g) => g.querySelectorAll('[aria-pressed=true]').length) }));
    expect(!/^0 мин/.test(r.w) && r.pressed.every((n) => n === 1), 'settings: null-поля заменяются умолчаниями', JSON.stringify(r));
    // ARIA сегментов и слайдера
    const a = await s.p.evaluate(() => [...document.querySelectorAll('.seg')].map((g) => {
      const l = g.getAttribute('aria-labelledby');
      const b = g.querySelector('button');
      return { label: l && document.getElementById(l) ? document.getElementById(l).textContent.trim() : g.getAttribute('aria-label'), btn: b.getAttribute('aria-label') || b.textContent };
    }).concat([{ label: 'slider', btn: document.getElementById('scale').getAttribute('aria-valuetext') || '' }]));
    expect(a.slice(0, -1).every((x) => x.label && /мин/.test(x.btn)), 'settings: у сегментов есть подпись и единицы', JSON.stringify(a));
    expect(/%/.test(a[a.length - 1].btn), 'settings: у слайдера размера есть aria-valuetext', a[a.length - 1].btn);
    await s.close();
  }
  {
    const s = await open('welcome.html?slide=1', { init: NULLS });
    const w = await s.p.evaluate(() => document.querySelector('[data-t=water]').textContent);
    expect(w === '45 мин', 'welcome: null-поля заменяются умолчаниями', w);
    await s.close();
  }

  await browser.close();
  srv.close();
  console.log(`r2-F8: ${oks.length} ок, ${fails.length} провалов`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
