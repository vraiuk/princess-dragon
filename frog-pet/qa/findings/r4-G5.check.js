'use strict';
// Регрессия круга 4 (G5): браузерное демо и режим съёмки.
//   node qa/findings/r4-G5.check.js
// r1-04-10: ?film=short&stage=desktop на 1280×800 и 1920×1080 — без карточки демо, жаба крупно справа внизу,
//           титр, счётчики, облачко и жаба в правой колонке 9:16 (её можно вырезать под шортс).
// r3-02-02: название сценария в select карточки демо помещается целиком (1280 и 375).
// r3-05-05: 🐸 в меню-баре демо после напоминания: «Пора пить воду», а не «Вода через 0 мин».
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

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
  const base = `http://127.0.0.1:${srv.address().port}/app/renderer/index.html`;
  const b = await chromium.launch();
  try {
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(base + '?film=short&stage=desktop');
      await p.waitForFunction(() => { const d = window.frog._demo.director; return d && d.elapsed >= 16.3; }, null, { polling: 100, timeout: 60000 });
      const g = await p.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height, d: getComputedStyle(e).display }; };
        return { card: r('.demo-card'), pet: r('#pet'), cap: r('.demo-cap'), hud: r('.demo-hud'), bub: r('#bubble'), capOn: !document.querySelector('.demo-cap').classList.contains('off') };
      });
      const col = h * 9 / 16, x0 = w - col - 1;
      expect(g.card.d === 'none', `${w}: карточки демо нет`, g.card.d);
      expect(g.pet.h >= h * 0.5, `${w}: жаба крупно (≥ 50% высоты)`, g.pet.h);
      expect(g.pet.b >= h - 20 && g.pet.x >= x0, `${w}: жаба справа внизу`, JSON.stringify(g.pet));
      for (const k of ['cap', 'hud', 'bub']) expect(g[k].x >= x0 && g[k].r <= w + 1, `${w}: ${k} в колонке 9:16 справа`, JSON.stringify(g[k]));
      expect(g.capOn, `${w}: титр виден`);
      await p.close();
    }
    for (const [w, h] of [[1280, 800], [375, 740]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(base);
      await p.waitForTimeout(600);
      const fit = await p.evaluate(() => {
        const s = document.getElementById('dFilmPick');
        const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(s).font;
        return [...s.options].map((o) => ({ t: o.text, ok: c.measureText(o.text).width <= s.clientWidth - 28 }));
      });
      fit.forEach((f) => expect(f.ok, `${w}: «${f.t}» влезает в select`));
      await p.evaluate(() => window.frog._demo.ctl.ff(50, 1));
      await p.click('.demo-tray');
      await p.waitForTimeout(400);
      const txt = await p.evaluate(() => document.querySelector('#bubble .txt').textContent + ' / ' + document.getElementById('dStats').textContent);
      expect(!/через 0\b/.test(txt) && /[Пп]ора пить воду/.test(txt), `${w}: меню-бар и счётчик говорят «пора пить воду»`, txt);
      await p.close();
    }
  } finally { await b.close(); srv.close(); }
  oks.forEach((n) => console.log('[ok]', n));
  fails.forEach((n) => console.log('[FAIL]', n));
  process.exit(fails.length ? 1 : 0);
})();
