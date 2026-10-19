'use strict';
// Регрессия круга 2 для окна «Трофеи» (F7): r1-08-03/06/07/12, r1-05-02/13/15/16.
//   node qa/findings/r2-F7.check.js [--shots DIR]
// Контраст считается по вычисленным цветам (WCAG 2.x), включая SVG-текст графиков.
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

// все текстовые узлы видимой панели с контрастом ниже AA
function lowContrast() {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const blend = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  const bgOf = (el) => {
    const st = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { st.push(c); if (c[3] >= 1) break; }
    }
    let b = [255, 255, 255, 1];
    for (let i = st.length - 1; i >= 0; i--) b = blend(st[i], b);
    return b;
  };
  const out = [];
  const seen = new Set();
  for (const root of [document.querySelector('.tr-head'), document.querySelector('.tr-pane:not([hidden])')]) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode; if (!t.textContent.trim() || /^[\p{Extended_Pictographic}\uFE0F\u200D\s·]+$/u.test(t.textContent)) continue;
    const el = t.parentElement; if (seen.has(el) || el.closest('title')) continue; seen.add(el);
    const cs = getComputedStyle(el);
    const svg = el instanceof SVGElement;
    let fg = parse(svg ? cs.fill : cs.color); if (!fg) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    if (svg) op *= +cs.fillOpacity;
    // каменные плиты кладбища нарисованы градиентом: берём их самый светлый/тёмный край как фон
    const stone = el.closest('.stone');
    const bgs = stone ? (matchMedia('(prefers-color-scheme: dark)').matches ? [[0x45, 0x40, 0x3a, 1], [0x3a, 0x3e, 0x3b, 1]] : [[0xec, 0xe3, 0xd2, 1], [0xe2, 0xd6, 0xbe, 1], [0xe9, 0xe7, 0xe1, 1]]) : [bgOf(el)];
    for (const bg of bgs) {
      const f = blend([fg[0], fg[1], fg[2], fg[3] * op], bg);
      const L1 = lum(f), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
      if (cr < (large ? 3 : 4.5)) { out.push(`${t.textContent.trim().slice(0, 24)} [${svg ? el.getAttribute('class') : el.className}] ${cr.toFixed(2)}`); break; }
    }
  }
  }
  return out;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/trophies.html`;
  const browser = await chromium.launch();
  const open = async (hash, { scheme = 'light', data = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 720, height: 560 }, colorScheme: scheme });
    if (data) await ctx.addInitScript((d) => { window.frogApp = { getData: () => Promise.resolve(d), onUpdate() {}, close() {} }; }, data);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.goto(base + hash);
    await p.waitForTimeout(500);
    return { p, errors, close: () => ctx.close() };
  };

  // 1. контраст AA во всех вкладках, обе темы (r1-08-03)
  for (const scheme of ['light', 'dark']) {
    for (const t of ['ach', 'stats', 'grave']) {
      const s = await open('#' + t, { scheme });
      const low = await s.p.evaluate(lowContrast);
      expect(low.length === 0, `contrast ${t}/${scheme} ≥ 4.5`, low.slice(0, 8).join(' | '));
      expect(s.errors.length === 0, `no errors ${t}/${scheme}`, s.errors.join(' | '));
      if (SHOTS) await s.p.screenshot({ path: path.join(SHOTS, `${t}-${scheme}.png`), fullPage: true });
      await s.close();
    }
  }

  // 2. мок строится из настоящих DEFS (r1-05-13)
  {
    const s = await open('#ach');
    const r = await s.p.evaluate(() => {
      const ids = new Set((window.FrogAchievements ? FrogAchievements.DEFS : []).map((d) => d.id));
      const titles = [...document.querySelectorAll('.ach-title')].map((e) => e.textContent);
      return { defs: ids.size, cards: titles.length, fake: titles.filter((x) => /Кит-девелопер|Agile|император|Чит-код|Ночной деплой|Серийный/.test(x)) };
    });
    expect(r.defs > 0 && r.cards === r.defs && r.fake.length === 0, 'mock = DEFS', JSON.stringify(r));
    await s.close();
  }

  // 3. фильтр: фокус остаётся на чипе, aria-pressed (r1-08-06)
  {
    const s = await open('#ach');
    await s.p.focus('.chip[data-f="bad"]');
    await s.p.keyboard.press('Enter');
    await s.p.waitForTimeout(100);
    const r = await s.p.evaluate(() => ({ f: document.activeElement.dataset && document.activeElement.dataset.f, pressed: [...document.querySelectorAll('.chip')].map((c) => c.getAttribute('aria-pressed')).join(',') }));
    expect(r.f === 'bad', 'chip keeps focus after Enter', JSON.stringify(r));
    expect(r.pressed === 'false,false,true,false', 'chip aria-pressed', r.pressed);
    await s.close();
  }

  // 4. ARIA вкладок, стрелки, имена графиков (r1-08-07)
  {
    const s = await open('#ach');
    const a = await s.p.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((b) => {
      const pane = document.getElementById(b.getAttribute('aria-controls') || '-');
      return !!pane && pane.getAttribute('aria-labelledby') === b.id && b.id !== '';
    }).every(Boolean));
    expect(a, 'tabs aria-controls/aria-labelledby');
    await s.p.focus('[role=tab][data-tab="ach"]');
    await s.p.keyboard.press('ArrowRight');
    await s.p.waitForTimeout(100);
    const r = await s.p.evaluate(() => ({ focus: document.activeElement.dataset.tab, sel: document.querySelector('[aria-selected=true]').dataset.tab, ti: [...document.querySelectorAll('[role=tab]')].map((b) => b.tabIndex).join(','), visible: !document.getElementById('pane-stats').hidden }));
    expect(r.focus === 'stats' && r.sel === 'stats' && r.ti === '-1,0,-1' && r.visible, 'ArrowRight + roving tabindex', JSON.stringify(r));
    await s.p.keyboard.press('End');
    expect(await s.p.evaluate(() => document.activeElement.dataset.tab) === 'grave', 'End → последняя вкладка');
    await s.p.keyboard.press('Home');
    expect(await s.p.evaluate(() => document.activeElement.dataset.tab) === 'ach', 'Home → первая вкладка');
    await s.close();
    const s2 = await open('#stats');
    const names = await s2.p.evaluate(() => [...document.querySelectorAll('svg.chart')].map((c) => c.getAttribute('aria-label') || ''));
    expect(names.length === 3 && names.every((n) => n.length > 10), 'charts have aria-label', JSON.stringify(names));
    await s2.close();
  }

  // 5. битые записи не роняют вкладку (r1-08-12)
  {
    const now = Date.now();
    const data = {
      view: { totals: { breaks: 1 } }, state: { day: null, history: [null] },
      achievements: [null, { id: 'x', title: 'Живая ачивка', kind: 'good', unlocked: true, at: now }, 7],
      graveyard: [null, { generation: 3, cause: 'dry', diedAt: now, ageMin: 2950 }, 'oops'],
    };
    for (const [t, sel, want] of [['ach', '.ach-title', 'Живая ачивка'], ['grave', '.g-name', 'Жабка #3']]) {
      const s = await open('#' + t, { data });
      const txt = await s.p.evaluate((q) => [...document.querySelectorAll(q)].map((e) => e.textContent).join('|'), sel);
      expect(txt === want, `null in ${t} skipped`, txt);
      if (t === 'grave') {
        const g = await s.p.evaluate(() => [...document.querySelectorAll('.g-age, .gh-s')].map((e) => e.textContent).join(' / '));
        expect(/прожила 2 дня 1 ч/.test(g), 'grave age «2 дня 1 ч»', g);
        expect(/засохших: 1 · 🗿 окаменевших: 0/.test(g), 'grave counts plural form (r1-05-15)', g);
      }
      if (SHOTS) await s.p.screenshot({ path: path.join(SHOTS, `null-${t}.png`) });
      await s.close();
    }
  }

  // 6. склонения в статистике (r1-05-02) и «1,5 ч» (r1-05-16)
  {
    const want = { 1: '1 перерыв (вместе с разминками)', 2: '2 перерыва (вместе с разминками)', 5: '5 перерывов (вместе с разминками)', 21: '21 перерыв (вместе с разминками)', 22: '22 перерыва (вместе с разминками)', 11: '11 перерывов (вместе с разминками)' };
    for (const n of Object.keys(want)) {
      const d = new Date(), key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const s = await open('#stats', { data: { view: { totals: { breaks: n - 1, autoBreaks: 1 } }, state: { day: { date: key, codingMs: 90 * 60000 }, history: [] }, achievements: [], graveyard: [] } });
      const r = await s.p.evaluate(() => {
        const t = [...document.querySelectorAll('.tile')].find((x) => x.textContent.includes('🤸'));
        const v = document.querySelector('.chart.c-code .today .val');
        return { tile: t.querySelector('.tile-b').textContent + ' ' + t.querySelector('.tile-s').textContent, lbl: v && v.textContent };
      });
      expect(r.tile === want[n], `breaks plural n=${n}`, r.tile);
      if (n === '1') expect(r.lbl === '1,5 ч', 'chart label «1,5 ч»', r.lbl);
      await s.close();
    }
  }

  await browser.close();
  srv.close();
  for (const o of oks) console.log('ok  ', o);
  for (const f of fails) console.log('FAIL', f);
  console.log(`${oks.length} ok, ${fails.length} fail`);
  process.exit(fails.length ? 1 : 0);
})();
