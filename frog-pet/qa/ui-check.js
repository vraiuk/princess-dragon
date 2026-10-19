'use strict';
// Автопроверка интерфейса в браузере (детерминированные проверки + скриншоты для LLM-судей).
//   node qa/ui-check.js [--out qa/out] [--film]
// Поднимает статический сервер, проходит сцены через window.__frogDebug и проверяет:
// ошибки консоли, облачко/тост в пределах окна и не перекрывают друг друга, бюджет частиц и fps,
// окна трофеев/настроек/приветствия и лендинг без горизонтального скролла.
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(__dirname, 'out'));
const FILM = argv.includes('--film');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain' };
function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let f = p;
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const failures = [];
const passed = [];
function expect(cond, name, detail) {
  (cond ? passed : failures).push(cond ? name : `${name}: ${detail || ''}`);
}

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();

  async function page(url, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 720 }, deviceScaleFactor: opts.dpr || 2, colorScheme: opts.scheme || 'light' });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(base + url);
    await p.waitForTimeout(opts.wait || 1200);
    return { p, errors, close: () => ctx.close() };
  }

  // геометрия облачка, тоста и окна жабы
  const geom = (p) => p.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: b.x, y: b.y, w: b.width, h: b.height, visible: cs.opacity > 0.05 && cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 }; };
    return { pet: r('#pet'), bubble: r('#bubble'), toast: r('#toast'), side: r('#side'), bubbleClass: document.querySelector('#bubble').className };
  });
  const inside = (a, b) => a.y >= b.y - 2 && a.x >= b.x - 2 && a.x + a.w <= b.x + b.w + 2;
  const overlap = (a, b) => a && b && a.visible && b.visible && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  async function scene(name, fn, opts) {
    const s = await page('/app/renderer/index.html?clean=1', opts);
    try {
      await fn(s.p);
      const g = await geom(s.p);
      if (g.bubble && g.bubble.visible) expect(inside(g.bubble, g.pet), `${name}: облачко в пределах окна`, JSON.stringify(g.bubble));
      expect(!overlap(g.bubble, g.toast), `${name}: тост не перекрывает облачко`, `bubble=${JSON.stringify(g.bubble)} toast=${JSON.stringify(g.toast)}`);
      if (g.toast && g.toast.visible) expect(inside(g.toast, g.pet), `${name}: тост в пределах окна`, JSON.stringify(g.toast));
      await s.p.locator('#pet').screenshot({ path: path.join(OUT, `scene-${name}.png`) });
      expect(s.errors.length === 0, `${name}: без ошибок консоли`, s.errors.join(' | '));
    } catch (e) {
      expect(false, `${name}: сцена выполнилась`, e.message);
    } finally { await s.close(); }
  }

  const dbg = (p, js) => p.evaluate(js);
  const ev = (p, e) => p.evaluate((x) => window.__frogDebug.event(x), e);
  const view = (p, v) => p.evaluate((x) => window.__frogDebug.view(x), v);

  await scene('idle', async (p) => {
    const a = await dbg(p, () => window.__frogDebug.state());
    await p.waitForTimeout(5000);
    const b = await dbg(p, () => window.__frogDebug.state());
    const fps = (b.frames - a.frames) / 5;
    expect(fps >= 15 && fps <= 40, 'idle: fps в бюджете 15–40', `fps=${fps.toFixed(1)}`);
    expect(b.particles < 60, 'idle: мало частиц в покое', `particles=${b.particles}`);
    expect(await dbg(p, () => !!window.__frogDebug.hit(130, 180)), 'idle: клик по жабе попадает в жабу');
    expect(!(await dbg(p, () => window.__frogDebug.hit(5, 5))), 'idle: угол окна прозрачен для кликов');
  });
  await scene('remind-water', async (p) => { await ev(p, { type: 'remind', kind: 'water', level: 1, nag: 1, text: 'git commit -m "выпил воды" — самый лёгкий коммит за день 💧' }); await p.waitForTimeout(600); });
  await scene('remind-move-tip', async (p) => { await ev(p, { type: 'remind', kind: 'move', level: 1.6, nag: 3, text: 'Сидишь 95 мин. Меня уже можно ставить в парке, рядом с голубями.', tip: 'Сведи лопатки 10 раз — спина скажет спасибо.' }); await p.waitForTimeout(600); });
  await scene('critical', async (p) => { await view(p, { dry: 0.9, glass: 0, critical: { water: true, move: false }, doom: { water: 0.85, move: 0.1 } }); await ev(p, { type: 'critical', kind: 'water', text: 'Я при смерти. Последний шанс — стакан воды!' }); await p.waitForTimeout(1200); });
  await scene('toast+bubble', async (p) => {
    await ev(p, { type: 'remind', kind: 'water', level: 1, nag: 1, text: 'Попей воды 💧' });
    await ev(p, { type: 'achievement', id: 'first_drink', title: 'Первый глоток', desc: 'Начало положено', icon: '💧', kind: 'good', rarity: 'common' });
    await p.waitForTimeout(700);
  });
  for (const cause of ['stone', 'dry']) {
    await scene(`death-${cause}`, async (p) => {
      await ev(p, { type: 'death', cause, generation: 3, ageMin: 134, text: cause === 'stone' ? 'Жабка окаменела. Теперь она — памятник твоему коду, и ей больше не нужен code review.' : 'Жабка засохла в изюм. Её последний коммит был без тестов и без воды.' });
      await view(p, { life: 'dead', cause, generation: 3, ageMin: 134 });
      await p.waitForTimeout(11000);
      const st = await dbg(p, () => window.__frogDebug.state());
      expect(/dead|grave/.test(String(st.mode)), `death-${cause}: дошли до надгробия`, `mode=${st.mode}`);
      const side = await geom(p);
      expect(!(side.side && side.side.visible), `death-${cause}: кнопки сбоку скрыты у надгробия`);
    }, { wait: 1500 });
  }
  await scene('reborn', async (p) => {
    await view(p, { life: 'dead', cause: 'stone', generation: 3 });
    await p.waitForTimeout(800);
    await view(p, { life: 'alive', generation: 4, ageMin: 0 });
    await ev(p, { type: 'reborn', generation: 4, text: 'Вылупилась Жабка #4!' });
    await p.waitForTimeout(7000);
    const st = await dbg(p, () => window.__frogDebug.state());
    expect(st.life !== 'dead' && !/dead|grave/.test(String(st.mode)), 'reborn: жаба снова жива', `mode=${st.mode}`);
    expect(st.particles < 120, 'reborn: частицы убраны после анимации', `particles=${st.particles}`);
  });
  await scene('dpr1-scale', async (p) => { await p.waitForTimeout(300); }, { dpr: 1 });

  // окна приложения (мок frogApp) — светлая и тёмная тема
  for (const [name, url] of [['trophies', '/app/renderer/trophies.html'], ['trophies-stats', '/app/renderer/trophies.html#stats'], ['trophies-grave', '/app/renderer/trophies.html#grave'], ['settings', '/app/renderer/settings.html'], ['welcome', '/app/renderer/welcome.html'], ['welcome-4', '/app/renderer/welcome.html?slide=4']]) {
    for (const scheme of ['light', 'dark']) {
      const size = name.startsWith('trophies') ? { width: 720, height: 560 } : name.startsWith('settings') ? { width: 520, height: 560 } : { width: 560, height: 520 };
      const s = await page(url, { viewport: size, scheme });
      const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ov <= 0, `${name}/${scheme}: без горизонтального скролла`, `overflow=${ov}px`);
      expect(s.errors.length === 0, `${name}/${scheme}: без ошибок консоли`, s.errors.join(' | '));
      await s.p.screenshot({ path: path.join(OUT, `win-${name}-${scheme}.png`) });
      await s.close();
    }
  }

  // лендинг
  for (const w of [1280, 390]) {
    const s = await page('/index.html', { viewport: { width: w, height: 900 }, wait: 2500 });
    const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ov <= 0, `landing ${w}px: без горизонтального скролла`, `overflow=${ov}px`);
    expect(s.errors.length === 0, `landing ${w}px: без ошибок консоли`, s.errors.join(' | '));
    await s.p.screenshot({ path: path.join(OUT, `landing-${w}.png`), fullPage: true });
    await s.close();
  }

  // сценарий съёмки (долго, по флагу)
  if (FILM) {
    const s = await page('/app/renderer/index.html?film=stone&ratio=9:16', { viewport: { width: 540, height: 960 }, wait: 500 });
    for (let i = 0; i < 10; i++) { await s.p.waitForTimeout(3000); await s.p.screenshot({ path: path.join(OUT, `film-stone-${String(i).padStart(2, '0')}.png`) }); }
    expect(s.errors.length === 0, 'film stone: без ошибок консоли', s.errors.join(' | '));
    await s.close();
  }

  await browser.close();
  srv.close();
  const report = { passed: passed.length, failed: failures.length, failures, out: OUT };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, passedList: passed }, null, 2));
  console.log(`UI-проверки: ${passed.length} ок, ${failures.length} провалов. Скриншоты: ${OUT}`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
