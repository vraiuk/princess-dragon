'use strict';
// Регрессия круга 4 для окна «Трофеи» (G6): r1-05-05, r3-08-05, r3-05-03.
//   node qa/findings/r4-G6.check.js
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const Core = require('../../app/core.js');

const ROOT = path.resolve(__dirname, '..', '..');
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

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/trophies.html`;
  const browser = await chromium.launch();
  const open = async (hash, data) => {
    const ctx = await browser.newContext({ viewport: { width: 720, height: 560 } });
    await ctx.addInitScript((d) => { window.frogApp = { getData: () => Promise.resolve(d), onUpdate() {}, close() {} }; }, data);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.goto(base + hash);
    await p.waitForTimeout(400);
    return { p, errors, close: () => ctx.close() };
  };
  const now = Date.now();

  // 1. r1-05-05: длительности как в ядре (надгробие), в том числе от 5 дней
  for (const min of [59, 61, 1500, 2950, 5 * 1440 + 180, 6 * 1440 + 1320, 10 * 1440 + 200]) {
    const want = Core.fmtDur(min);
    const data = {
      view: { ageMin: min, totals: { longestLifeMin: min } }, state: { day: null, history: [] }, achievements: [],
      graveyard: [{ generation: 1, cause: 'stone', bornAt: now - min * 60000, diedAt: now, ageMin: min }],
    };
    let s = await open('#grave', data);
    const age = await s.p.evaluate(() => document.querySelector('.g-age').textContent);
    expect(age === 'прожила ' + want, `grave age ${min} = core «${want}»`, age);
    expect(s.errors.length === 0, `no errors grave ${min}`, s.errors.join(' | '));
    await s.close();
    s = await open('#stats', data);
    const t = await s.p.evaluate(() => [...document.querySelectorAll('.tile')].filter((x) => /🧬|🎂/.test(x.textContent)).map((x) => x.querySelector('.tile-b').textContent));
    expect(t.length === 2 && t.every((x) => x === want), `stats tiles ${min} = core «${want}»`, JSON.stringify(t));
    await s.close();
  }

  // 2. r3-08-05: битые даты → «?» / не выводятся, без «Invalid Date»
  {
    const data = {
      view: {}, state: { day: null, history: [] },
      achievements: [{ id: 'x', title: 'Битая дата', kind: 'good', unlocked: true, at: 'bad' }, { id: 'y', title: 'Пустая дата', kind: 'good', unlocked: true, at: NaN }],
      graveyard: [{ generation: 2, cause: 'dry', bornAt: {}, diedAt: 'never', ageMin: 30 }, { generation: 3, cause: 'dry', bornAt: 1e20, diedAt: now, ageMin: 30 }],
    };
    for (const t of ['ach', 'grave']) {
      const s = await open('#' + t, data);
      const txt = await s.p.evaluate(() => document.querySelector('.tr-pane:not([hidden])').textContent);
      expect(!/Invalid|NaN/.test(txt), `no Invalid Date in ${t}`, (txt.match(/.{0,30}(Invalid|NaN).{0,30}/) || [''])[0]);
      expect(s.errors.length === 0, `no errors ${t} bad dates`, s.errors.join(' | '));
      if (t === 'grave') {
        const d = await s.p.evaluate(() => [...document.querySelectorAll('.g-dates')].map((e) => e.textContent.trim()));
        expect(d[1] === '? — ?' && /^\? — \d/.test(d[0]), 'bad dates shown as «?»', JSON.stringify(d));
      }
      await s.close();
    }
  }

  // 3. r3-05-03: засохшей жабе не достаётся эпитафия про «встану»
  {
    const graveyard = [];
    for (let g = 1; g <= 60; g++) graveyard.push({ generation: g, cause: 'dry', diedAt: now - g * 1000, ageMin: 100 });
    const s = await open('#grave', { view: {}, state: {}, achievements: [], graveyard });
    const bad = await s.p.evaluate(() => [...document.querySelectorAll('.g-epi')].map((e) => e.textContent).filter((x) => /встан/.test(x)));
    expect(bad.length === 0, 'dry grave has no «встану» epitaph', bad[0]);
    await s.close();
  }

  await browser.close();
  srv.close();
  for (const o of oks) console.log('ok  ', o);
  for (const f of fails) console.log('FAIL', f);
  console.log(`${oks.length} ok, ${fails.length} fail`);
  process.exit(fails.length ? 1 : 0);
})();
