'use strict';
// Автопроверка интерфейса в браузере (детерминированные проверки + скриншоты для LLM-судей).
//   node qa/ui-check.js [--out qa/out] [--film]
// Поднимает статический сервер, проходит сцены через window.__frogDebug и проверяет:
// ошибки консоли, облачко/тост в пределах окна и не перекрывают друг друга, бюджет частиц и fps,
// окна трофеев/настроек/приветствия и лендинг без горизонтального скролла.
// Классы багов круга 1: обрезанный текст облачка и совета, бесконечные анимации при reduced motion,
// кадры без пауз в покое и в спрятанном окне, контраст кнопок, элементы за правым краем при overflow-x:hidden.
// QA_ROOT=/путь/к/копии — проверить другую копию приложения (мутационная проверка самих проверок).
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(process.env.QA_ROOT || path.join(__dirname, '..'));
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
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 720 }, deviceScaleFactor: opts.dpr || 2, colorScheme: opts.scheme || 'light', reducedMotion: opts.reducedMotion || 'no-preference' });
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
  const fpsOver = async (p, ms) => {
    const a = await p.evaluate(() => window.__frogDebug.state().frames);
    await p.waitForTimeout(ms);
    const b = await p.evaluate(() => window.__frogDebug.state().frames);
    return (b - a) / (ms / 1000);
  };
  const ev = (p, e) => p.evaluate((x) => window.__frogDebug.event(x), e);
  const view = (p, v) => p.evaluate((x) => window.__frogDebug.view(x), v);

  await scene('idle', async (p) => {
    const a = await dbg(p, () => window.__frogDebug.state());
    await p.waitForTimeout(5000);
    const b = await dbg(p, () => window.__frogDebug.state());
    const fps = (b.frames - a.frames) / 5;
    expect(fps > 0 && fps <= 40, 'idle: fps не больше 40', `fps=${fps.toFixed(1)}`);
    expect(b.particles < 60, 'idle: мало частиц в покое', `particles=${b.particles}`);
    expect(await dbg(p, () => !!window.__frogDebug.hit(130, 180)), 'idle: клик по жабе попадает в жабу');
    expect(!(await dbg(p, () => window.__frogDebug.hit(5, 5))), 'idle: угол окна прозрачен для кликов');
    // человек отошёл, ничего не происходит — кадры редкие (r1-09-02)
    await view(p, { activity: 'away' });
    await p.waitForTimeout(1500);
    const awayFps = await fpsOver(p, 4000);
    expect(awayFps <= 10, 'idle: человек отошёл — не больше 10 кадров/с', `fps=${awayFps.toFixed(1)}`);
    // окно спрятано — ни одного кадра (r1-09-01)
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(300);
    const hiddenFps = await fpsOver(p, 2000);
    expect(hiddenFps === 0, 'idle: спрятанное окно не рисует кадры', `fps=${hiddenFps.toFixed(1)}`);
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
      // надгробие стоит часами: кадры почти на паузе (r1-09-04)
      const graveFps = await fpsOver(p, 4000);
      expect(graveFps <= 3, `death-${cause}: надгробие не больше 3 кадров/с`, `fps=${graveFps.toFixed(1)}`);
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

  // все реплики из core: текст облачка и совет не обрезаны (r1-02-02, r1-03-05, r1-05-06, r1-05-17)
  {
    const s = await page('/app/renderer/index.html?clean=1');
    const cut = await s.p.evaluate(() => {
      const P = window.FrogCore.PHRASES;
      const CTX = { min: '1 ч 35 мин', n: 12, drinks: 7, breaks: 5, coding: '3 ч 20 мин', maxSit: '1 ч 5 мин', gen: 12, age: '2 дня 3 ч' };
      const fill = (x) => x.replace(/\{(\w+)\}/g, (_, k) => (CTX[k] != null ? CTX[k] : ''));
      const list = (k) => (P[k] || []).map(fill);
      const cases = [];
      for (const text of list('move').concat(list('moveBad'))) for (const tip of list('exercise')) cases.push([{ type: 'remind', kind: 'move', level: 1.6, nag: 2, text, tip }]);
      for (const text of list('water').concat(list('waterBad'))) cases.push([{ type: 'remind', kind: 'water', level: 1.2, nag: 1, text }]);
      for (const tip of list('exercise')) cases.push([{ type: 'remind', kind: 'water', level: 1, nag: 1, text: list('water')[0] }, { type: 'remind', kind: 'move', level: 1, nag: 1, text: list('move')[0], tip }]);
      for (const k of ['water', 'move']) for (const text of list('critical_' + k)) cases.push([{ type: 'critical', kind: k, text }]);
      for (const [type, key] of [['drink', 'drink'], ['stretch', 'stretch'], ['back', 'back'], ['back', 'backDead'], ['poke', 'poke'], ['paused', 'paused'], ['resumed', 'resumed'], ['resumed', 'resumedDead']]) {
        for (const text of list(key)) cases.push([{ type, text, min: 95, n: 12 }]);
      }
      const bad = [];
      const pet = document.querySelector('#pet').getBoundingClientRect();
      for (const evs of cases) {
        window.__frogDebug.event({ type: 'paused' }); // сбросить ждущие напоминания
        evs.forEach((e) => window.__frogDebug.event(e));
        const b = document.querySelector('#bubble');
        const r = b.getBoundingClientRect();
        const what = evs.map((e) => e.text + (e.tip ? ' / ' + e.tip : '')).join(' + ');
        for (const sel of ['.txt', '.tip']) {
          const el = b.querySelector(sel);
          if (el.textContent && el.scrollHeight > el.clientHeight + 1) bad.push(`${sel} обрезан (${el.scrollHeight}>${el.clientHeight}): ${what}`);
        }
        for (const btn of b.querySelectorAll('button')) if (btn.scrollWidth > btn.clientWidth + 1) bad.push(`кнопка «${btn.textContent}» обрезана: ${what}`);
        if (r.top < pet.top - 1) bad.push(`облачко выше окна на ${Math.round(pet.top - r.top)}px: ${what}`);
      }
      return { n: cases.length, bad };
    });
    expect(cut.bad.length === 0, `облачко: ${cut.n} реплик и советов не обрезаны`, `${cut.bad.length} обрезано, например: ${cut.bad.slice(0, 3).join(' | ')}`);
    expect(s.errors.length === 0, 'облачко-реплики: без ошибок консоли', s.errors.join(' | '));
    await s.close();
  }

  // prefers-reduced-motion: в окне жабы нет бесконечных анимаций (r1-08-10)
  {
    const s = await page('/app/renderer/index.html?clean=1', { reducedMotion: 'reduce' });
    const infinite = () => s.p.evaluate(() => document.getAnimations()
      .filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity)
      .map((a) => (a.animationName || a.constructor.name) + '@' + ((a.effect.target && (a.effect.target.id || a.effect.target.className)) || '?')));
    const found = [];
    await view(s.p, { dry: 0.9, glass: 0, needs: { water: true }, critical: { water: true, move: false }, doom: { water: 0.85, move: 0.1 } });
    await ev(s.p, { type: 'critical', kind: 'water', text: 'Я при смерти. Последний шанс — стакан воды!' });
    await s.p.mouse.move(130, 200);
    await s.p.waitForTimeout(800);
    found.push(...(await infinite()).map((x) => 'critical: ' + x));
    for (const [kind, rarity] of [['good', 'epic'], ['good', 'legendary'], ['bad', 'epic'], ['secret', 'legendary']]) {
      await ev(s.p, { type: 'achievement', id: 'x' + rarity, title: 'Проверка', desc: 'reduced motion', icon: '🏆', kind, rarity });
      await s.p.waitForTimeout(1200);
      found.push(...(await infinite()).map((x) => `toast ${kind}/${rarity}: ` + x));
    }
    await ev(s.p, { type: 'death', cause: 'stone', generation: 2, ageMin: 50, text: 'Жабка окаменела.' });
    await view(s.p, { life: 'dead', cause: 'stone', generation: 2, ageMin: 50 });
    await s.p.waitForTimeout(11000);
    found.push(...(await infinite()).map((x) => 'надгробие: ' + x));
    expect(found.length === 0, 'reduced motion: нет бесконечных анимаций', [...new Set(found)].join(', '));
    expect(s.errors.length === 0, 'reduced motion: без ошибок консоли', s.errors.join(' | '));
    await s.close();
  }

  // контраст текста ключевых кнопок ≥ 4.5:1 (r1-08-02)
  const contrastOf = (p, sel) => p.evaluate((sel) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] == null ? 1 : v[3]]; };
    const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
    const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      let bg = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      return bg;
    };
    return [...document.querySelectorAll(sel)].filter((el) => el.offsetWidth > 0 && el.textContent.trim()).map((el) => {
      const cs = getComputedStyle(el);
      const bg = bgOf(el);
      const fg = over(parse(cs.color), bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return { text: el.textContent.trim().slice(0, 24), ratio: (a + 0.05) / (b + 0.05) };
    });
  }, sel);
  {
    const s = await page('/app/renderer/index.html?clean=1');
    const low = [];
    const scenes = [
      ['вода', [{ type: 'remind', kind: 'water', level: 1, nag: 1, text: 'Попей воды 💧' }]],
      ['разминка', [{ type: 'remind', kind: 'move', level: 1, nag: 1, text: 'Разомнись', tip: 'Пройдись до кухни и обратно.' }]],
      ['оба', [{ type: 'remind', kind: 'water', level: 1, nag: 1, text: 'Вода' }, { type: 'remind', kind: 'move', level: 1, nag: 1, text: 'Движение' }]],
      ['при смерти', [{ type: 'critical', kind: 'water', text: 'Я при смерти!' }]],
    ];
    for (const [name, evs] of scenes) {
      await ev(s.p, { type: 'paused' });
      for (const e of evs) await ev(s.p, e);
      await s.p.waitForTimeout(500);
      for (const c of await contrastOf(s.p, '#bubble button')) if (c.ratio < 4.5) low.push(`${name} «${c.text}» ${c.ratio.toFixed(2)}`);
    }
    await ev(s.p, { type: 'death', cause: 'dry', generation: 2, ageMin: 50, text: 'Засохла.' });
    await view(s.p, { life: 'dead', cause: 'dry', generation: 2, ageMin: 50 });
    await s.p.waitForTimeout(11000);
    for (const c of await contrastOf(s.p, '#bubble button')) if (c.ratio < 4.5) low.push(`надгробие «${c.text}» ${c.ratio.toFixed(2)}`);
    expect(low.length === 0, 'контраст кнопок облачка ≥ 4.5:1', low.join(', '));
    await s.close();
  }

  // элементы за правым краем: scrollWidth слеп, если на html/body стоит overflow-x:hidden (handoff F9).
  // Не считаем то, что внутри position:fixed и внутри контейнеров, которые сами режут/прокручивают по x.
  const offRight = (p) => p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.position === 'fixed') return true;
        if (e !== el && /hidden|clip|auto|scroll/.test(cs.overflowX)) return true;
      }
      return false;
    };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= W + 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (clipped(el)) continue;
      out.push(`${name(el)} +${Math.round(r.right - W)}px`);
      if (out.length >= 5) break;
    }
    return out;
  });

  // окна приложения (мок frogApp) — светлая и тёмная тема
  for (const [name, url] of [['trophies', '/app/renderer/trophies.html'], ['trophies-stats', '/app/renderer/trophies.html#stats'], ['trophies-grave', '/app/renderer/trophies.html#grave'], ['settings', '/app/renderer/settings.html'], ['welcome', '/app/renderer/welcome.html'], ['welcome-4', '/app/renderer/welcome.html?slide=4']]) {
    for (const scheme of ['light', 'dark']) {
      const size = name.startsWith('trophies') ? { width: 720, height: 560 } : name.startsWith('settings') ? { width: 520, height: 560 } : { width: 560, height: 520 };
      const s = await page(url, { viewport: size, scheme });
      const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ov <= 0, `${name}/${scheme}: без горизонтального скролла`, `overflow=${ov}px`);
      const off = await offRight(s.p);
      expect(off.length === 0, `${name}/${scheme}: ничего не вылезает за правый край`, off.join(', '));
      const low = (await contrastOf(s.p, '.btn, .tabs button[aria-selected="true"], .seg button[aria-pressed="true"]')).filter((c) => c.ratio < 4.5);
      expect(low.length === 0, `${name}/${scheme}: контраст кнопок ≥ 4.5:1`, low.map((c) => `«${c.text}» ${c.ratio.toFixed(2)}`).join(', '));
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
    const off = await offRight(s.p);
    expect(off.length === 0, `landing ${w}px: ничего не вылезает за правый край`, off.join(', '));
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
