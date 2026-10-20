// Браузерное демо: если страница открыта не в Electron, имитируем main-процесс,
// рабочий стол macOS, даём перемотку времени и режим съёмки (FrogShowcase).
// Параметры URL: ?dry= ?stone= ?glass= ?activity= — зафиксировать вид (скриншоты),
// ?film=short|water|stone|tour — запустить сценарий, ?ratio=9:16 — вертикальная сцена,
// ?clean=1 — без UI демо (для iframe на лендинге),
// ?stage=desktop — запись горизонтального экрана: без карточки демо, жаба крупно справа внизу,
// титр и счётчики над ней (колонка 9:16 справа — можно обрезать под шортс).
(function () {
  'use strict';
  if (window.frog) return;
  const Core = window.FrogCore;
  const Show = window.FrogShowcase || null;
  const Ach = window.FrogAchievements || null;
  const MIN = Core.MIN;

  const q = new URLSearchParams(location.search);
  const VERT = q.get('ratio') === '9:16';
  const CLEAN = q.get('clean') === '1';
  const DESK = !VERT && !CLEAN && q.get('stage') === 'desktop';
  const SCALED = VERT || CLEAN || DESK;

  const root = document.documentElement;
  root.classList.add('demo');
  if (VERT) root.classList.add('demo-916');
  if (CLEAN) root.classList.add('demo-clean');
  if (DESK) root.classList.add('demo-desk');

  // ---------- масштаб жабы ----------
  // canvas в pet.js рисует с учётом devicePixelRatio, поэтому при увеличении через transform
  // подменяем DPR — иначе картинка будет мыльной.
  const realDpr = window.devicePixelRatio || 1;
  let zoom = 1;
  function calcZoom() {
    if (VERT) return Math.max(1, Math.min(innerWidth * 0.98 / 260, (innerHeight - 330) / 320));   // место под подпись сверху и HUD снизу
    if (CLEAN) return Math.max(0.5, Math.min(2, innerWidth / 280, innerHeight / 330));
    // десктоп: жаба на ~60% высоты под меню-баром, титром и счётчиками; колонка 9:16 справа
    if (DESK) return Math.max(1, Math.min(3, (innerHeight - 200) / 320, innerHeight * 9 / 16 / 270));
    return 1;
  }
  if (SCALED) {
    zoom = calcZoom();
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => realDpr * Math.max(1, Math.ceil(zoom * 2) / 2) });
    } catch (e) { /* не вышло — будет чуть мягче */ }
  }

  const css = document.createElement('style');
  css.textContent = `
    html.demo, html.demo body { overflow: hidden; height: 100%; }
    html.demo body { background: #1d2440 linear-gradient(160deg, #2b5876 0%, #4e4376 45%, #f0a07a 100%); font-size: 14px; }
    .demo-bar { position: fixed; top: 0; left: 0; right: 0; height: 26px; display: flex; align-items: center; gap: 18px; padding: 0 14px;
      background: rgba(20,22,35,.35); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: #fff; font-weight: 500; font-size: 13px; z-index: 5; }
    .demo-bar b { font-weight: 700; }
    .demo-bar .sp { flex: 1; }
    .demo-tray { padding: 1px 8px; border-radius: 5px; cursor: pointer; }
    .demo-tray:hover { background: rgba(255,255,255,.2); }
    .demo-card { position: fixed; top: 44px; left: 16px; width: min(380px, calc(100vw - 32px)); padding: 18px 18px 16px; border-radius: 18px;
      background: rgba(255,253,245,.94); color: #1f2a22; box-shadow: 0 20px 50px rgba(0,0,0,.35); z-index: 4; line-height: 1.45; }
    .demo-card h1 { margin: 0 0 6px; font-size: 22px; }
    .demo-card p { margin: 0 0 10px; color: #3c4a40; }
    .demo-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
    .demo-row span { font-weight: 600; margin-right: 4px; }
    .demo-card button, .demo-card a.btn, .demo-card select { border: 0; border-radius: 10px; padding: 6px 11px; background: #e7efe4; color: #1f2a22; font: 600 13px/1.2 inherit; font-family: inherit; cursor: pointer; text-decoration: none; }
    .demo-card button.on { background: #3fae5a; color: #fff; }
    .demo-card button.film.on { background: #b5487a; }
    .demo-row select { flex: 1 1 100%; min-width: 0; }   /* своей строкой: название сценария целиком (r3-02-02) */
    .demo-card a.btn { background: #1f2a22; color: #fff; display: inline-block; margin-top: 6px; }
    .demo-clock { font: 600 13px Menlo, monospace; color: #4b5a4f; }
    .demo-stats { font-size: 13px; color: #4b5a4f; }
    .demo-card details { margin-top: 8px; font-size: 13px; color: #3c4a40; }
    .demo-card summary { cursor: pointer; font-weight: 600; }
    #pet { position: fixed; right: 24px; bottom: 8px; z-index: 3; }
    .demo-note { position: fixed; top: 34px; right: 12px; width: 300px; padding: 10px 12px; border-radius: 14px; z-index: 6;
      background: rgba(245,245,250,.92); box-shadow: 0 10px 30px rgba(0,0,0,.3); color: #111; font-size: 13px;
      transition: transform .35s, opacity .35s; }
    .demo-note.off { transform: translateX(340px); opacity: 0; }
    .demo-note b { display: block; margin-bottom: 2px; }
    .demo-cap { position: fixed; left: 50%; top: 64px; z-index: 7; max-width: min(640px, calc(100vw - 32px)); transform: translateX(-50%);
      padding: 10px 18px; border-radius: 16px; background: rgba(12,14,24,.78); color: #fff; text-align: center;
      font: 800 20px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; letter-spacing: .01em;
      box-shadow: 0 10px 30px rgba(0,0,0,.35); transition: opacity .3s, transform .3s; pointer-events: none; }
    .demo-cap.off { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(.96); }
    .demo-hud { display: none; }
    @media (max-width: 640px) {
      .demo-card { padding: 14px; } .demo-card p.long, .demo-card details { display: none; }
      #pet { right: 50%; margin-right: -130px; }
    }

    /* ---------- без UI (iframe на лендинге) ---------- */
    html.demo-clean .demo-bar, html.demo-clean .demo-card, html.demo-clean .demo-note, html.demo-clean .demo-cap { display: none; }
    html.demo-clean body { background: transparent; }
    html.demo-clean #pet { left: 50%; right: auto; bottom: 0; margin: 0; transform-origin: 50% 100%;
      transform: translateX(-50%) scale(var(--z, 1)); }

    /* ---------- вертикальная сцена 9:16 для шортсов ---------- */
    html.demo-916 body {
      background:
        radial-gradient(ellipse 70% 38% at 50% 58%, rgba(98,214,140,.22), transparent 70%),
        radial-gradient(ellipse 90% 50% at 50% 110%, rgba(240,120,170,.28), transparent 70%),
        radial-gradient(circle at 15% 12%, rgba(90,140,255,.25), transparent 40%),
        linear-gradient(180deg, #0d1022 0%, #171a3a 45%, #22163a 100%);
    }
    html.demo-916 body::before { content: ""; position: fixed; inset: 0; pointer-events: none;
      background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1.4px); background-size: 22px 22px;
      mask-image: linear-gradient(180deg, #000 0%, transparent 80%); -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 80%); }
    html.demo-916 .demo-card, html.demo-916 .demo-note { display: none; }
    html.demo-916 #pet { left: 50%; top: 54%; right: auto; bottom: auto; margin: 0; transform-origin: 50% 50%;
      transform: translate(-50%, -50%) scale(var(--z, 2)); }
    html.demo-916 .demo-cap { top: 84px; font-size: 26px; padding: 12px 20px; border-radius: 20px; width: max-content; }
    /* счётчики — сюжет ролика («2 часа без воды»): сверху, а не в нижней трети под интерфейсом Shorts/TikTok */
    html.demo-916 .demo-hud { display: flex; position: fixed; left: 50%; top: 36px; transform: translateX(-50%); z-index: 6; gap: 6px;
      font: 700 15px/1 Menlo, ui-monospace, monospace; color: #e9ecff; white-space: nowrap;
      max-width: calc(100vw - 16px); flex-wrap: nowrap; justify-content: center; }
    html.demo-916 #hClock { display: none; }   /* часы уже есть в меню-баре */
    @media (max-width: 400px) { html.demo-916 .demo-hud { font-size: 13px; gap: 4px; } .demo-hud span { padding: 6px 7px; } }
    .demo-hud span { padding: 7px 9px; border-radius: 12px; background: rgba(255,255,255,.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
    .demo-hud .ff { background: #b5487a; opacity: 0; transition: opacity .25s; }
    .demo-hud .ff.on { opacity: 1; }
    .demo-hud .bad { background: rgba(230,70,70,.45); }

    /* ---------- запись десктопа ?stage=desktop: колонка 9:16 у правого края ---------- */
    html.demo-desk { --col: min(100vw, calc(100vh * 9 / 16)); }
    html.demo-desk .demo-card, html.demo-desk .demo-note { display: none; }
    html.demo-desk #pet { left: auto; right: calc(var(--col) / 2); top: auto; bottom: 6px; margin: 0; transform-origin: 50% 100%;
      transform: translateX(50%) scale(var(--z, 1.5)); }
    html.demo-desk .demo-cap { left: auto; right: calc(var(--col) / 2); top: 84px; transform: translateX(50%); width: max-content;
      max-width: calc(var(--col) - 24px); font-size: 24px; }
    html.demo-desk .demo-cap.off { transform: translateX(50%) translateY(-10px) scale(.96); }
    html.demo-desk .demo-hud { display: flex; position: fixed; left: auto; right: calc(var(--col) / 2); top: 36px; transform: translateX(50%); z-index: 6;
      gap: 6px; font: 700 15px/1 Menlo, ui-monospace, monospace; color: #e9ecff; white-space: nowrap; }
    html.demo-desk #hClock { display: none; }
  `;
  document.head.appendChild(css);

  document.title = 'Жабка — демо питомца-программиста';
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = '<b>Жабка</b><span>Файл</span><span>Правка</span><span class="sp"></span><span class="demo-tray" title="Меню жабки">🐸<span id="dTray"></span></span><span id="dTime"></span>';
  document.body.prepend(bar);

  const scripts = (Show && Show.SCRIPTS) || {};
  const filmOptions = Object.keys(scripts).map((k) => `<option value="${k}">${scripts[k].title || k}${scripts[k].duration ? ` (~${Math.round(scripts[k].duration)} с)` : ''}</option>`).join('');

  const card = document.createElement('div');
  card.className = 'demo-card';
  card.innerHTML = `
    <h1>🐸 Жабка</h1>
    <p>Питомец-программист для macOS. Сохнет, если ты не пьёшь воду, и каменеет, если долго сидишь.</p>
    <p class="long">Это демо в браузере. Наведи на жабу — появятся кнопки, кликни — она ответит, тащи — переедет. Перемотай время, чтобы посмотреть, как она засыхает и каменеет.</p>
    <div class="demo-row"><span>Время:</span>
      <button data-speed="1" class="on">×1</button><button data-speed="60">×60</button><button data-speed="300">×300</button>
      <span class="demo-clock" id="dClock"></span></div>
    <div class="demo-row"><button id="dAway">🚶 Отойти от компьютера</button><button id="dReset">↺ Сброс</button></div>
    ${filmOptions ? `<div class="demo-row"><button id="dFilm" class="film">🎬 Сценарий</button><select id="dFilmPick" title="Сценарий">${filmOptions}</select></div>` : ''}
    <div class="demo-stats" id="dStats"></div>
    <a class="btn" href="https://github.com/vraiuk/princess-dragon/releases?q=frog" target="_blank" rel="noopener">⬇︎ Скачать для macOS</a>
    <details><summary>Как она считает</summary>
      Вода: стакан пустеет за 45 мин, потом жаба просит пить и начинает сохнуть.
      Движение: через 50 мин сидения жаба напомнит размяться и начнёт каменеть снизу вверх.
      Если 5 минут не трогать мышь и клавиатуру (или заблокировать экран), перерыв засчитывается сам.
      Хардкор: 2 ч 15 мин без воды или 2 ч сидения — и жаба умирает. Потом можно высидеть новую 🥚
    </details>`;
  document.body.appendChild(card);

  const note = document.createElement('div');
  note.className = 'demo-note off';
  document.body.appendChild(note);

  const cap = document.createElement('div');
  cap.className = 'demo-cap off';
  document.body.appendChild(cap);

  const hud = document.createElement('div');
  hud.className = 'demo-hud';
  hud.innerHTML = '<span id="hClock"></span><span id="hWater"></span><span id="hSit"></span><span class="ff" id="hFF">⏩</span>';
  document.body.appendChild(hud);

  const $pet = document.getElementById('pet');
  function applyZoom() {
    if (!SCALED) return;
    zoom = calcZoom();
    $pet.style.setProperty('--z', zoom.toFixed(3));
  }
  applyZoom();
  window.addEventListener('resize', applyZoom);

  // ---------- имитация main ----------
  let speed = 1, away = false, awaySim = 0;   // awaySim — симулированный момент, когда «отошёл»
  let realLast = Date.now(), simNow = Date.now();
  let lastInput = Date.now();
  let filmIdle = null;           // во время съёмки простой задаёт сценарий
  let director = null;
  const listeners = { view: [], event: [], cursor: [], settings: [] };
  const emit = (k, v) => listeners[k].forEach((cb) => cb(v));
  const settings = Object.assign({}, Core.DEFAULTS);
  let pet = Core.createPet(null, settings, simNow);
  let ach = makeAch();
  pet.tick(simNow, 0);

  function makeAch() {
    try { return Ach && Ach.createAchievements ? Ach.createAchievements(null) : null; } catch (e) { console.warn('achievements', e); return null; }
  }

  ['mousemove', 'keydown', 'pointerdown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));

  // ?dry=0.8&stone=0.5&activity=away — зафиксировать состояние (для скриншотов)
  function forced() {
    const f = {};
    for (const k of ['dry', 'stone', 'glass']) if (q.has(k)) f[k] = +q.get(k);
    if (q.has('activity')) f.activity = q.get('activity');
    return f;
  }
  const curView = () => Object.assign(pet.view(simNow), forced());

  function idleSec() {
    if (filmIdle != null) return filmIdle;
    // простой в симулированном времени: при ×60 за 11 с «отошёл» на 11 мин, а не на час
    if (away) return Math.max(0, (simNow - awaySim) / 1000);
    return (Date.now() - lastInput) / 1000;
  }

  function showNote(title, text, ms) {
    note.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = title;
    note.append(b, document.createTextNode(text || ''));
    note.classList.remove('off');
    clearTimeout(showNote.t);
    showNote.t = setTimeout(() => note.classList.add('off'), ms || 5000);
  }

  function handle(ev) {
    if (director && director.line) director.line(ev);   // на съёмке — фиксированные фразы
    emit('event', ev);
    if (director) return;   // системные плашки на съёмке не нужны: сценарий возрождает сам
    if (ev.type === 'remind' && ev.nag >= 2) {
      showNote(ev.kind === 'water' ? '💧 Пора попить воды' : '🤸 Пора размяться', ev.text);
    } else if (ev.type === 'death') {
      showNote(ev.cause === 'stone' ? `💀 Жабка #${ev.generation || 1} окаменела` : `💀 Жабка #${ev.generation || 1} засохла в изюм`,
        'Нажми «🥚 Новая жаба», чтобы высидеть новую.', 6000);
    }
  }

  // Ачивки: проверка после шага; новые — событием в окно жабы
  function checkAch(events) {
    if (!ach) return;
    let fresh = [];
    try {
      fresh = ach.check({ now: simNow, events: events || [], view: pet.view(simNow), state: pet.serialize(), settings }) || [];
    } catch (e) { console.warn('achievements.check', e); return; }
    const script = director && director.script;
    fresh.forEach((a) => {
      if (script && Show.showAchievement && !Show.showAchievement(script, a)) return;
      emit('event', Object.assign({ type: 'achievement' }, a));
    });
  }

  // Шаг симуляции; события копятся для ачивок
  function step(dt, idle, acc) {
    simNow += dt;
    const evs = pet.tick(simNow, idle);
    evs.forEach(handle);
    acc.push(...evs);
  }

  const fmtDur = Core.fmtDur || ((min) => `${Math.round(min)} мин`);   // один формат с облачком и трофеями (r1-05-05)

  function render() {
    const v = curView();
    emit('view', v);
    const d = new Date(simNow);
    const hhmm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('dTime').textContent = hhmm;
    document.getElementById('dClock').textContent = hhmm;
    const dead = v.life === 'dead';
    document.getElementById('dTray').textContent = dead ? ' 🪦' : v.paused ? ' ⏸' : (v.needs.water ? ' 💧' : '') + (v.needs.move ? ' 🗿' : '');
    document.getElementById('dStats').textContent = dead
      ? `🪦 Жабка #${v.generation} ${v.cause === 'stone' ? 'окаменела' : 'засохла'}. Наведи на неё и нажми «🥚 Новая жаба»`
      : `${v.waterLeftMin > 0 ? '💧 вода через ' + fmtDur(v.waterLeftMin) : '💧 пора пить воду'} · 🧘 сидишь ${fmtDur(v.sitMin || 0)} · сегодня стаканов ${v.day.drinks}, перерывов ${v.day.breaks}`;
    if (VERT || DESK) {
      const noWater = Math.round((v.waterRatio || 0) * settings.waterEvery);
      document.getElementById('hClock').textContent = '🕒 ' + hhmm;
      const $w = document.getElementById('hWater'), $s = document.getElementById('hSit');
      $w.textContent = dead ? (v.cause === 'dry' ? '💧 RIP' : '💧 —') : '💧 без воды ' + fmtDur(noWater);
      $s.textContent = dead ? (v.cause === 'stone' ? '🪑 RIP' : '🪑 —') : '🪑 сидит ' + fmtDur(v.sitMin || 0);
      $w.classList.toggle('bad', !!(v.needs.water || (v.critical && v.critical.water) || (dead && v.cause === 'dry')));
      $s.classList.toggle('bad', !!(v.needs.move || (v.critical && v.critical.move) || (dead && v.cause === 'stone')));
    }
  }

  function tick() {
    const now = Date.now();
    const realDt = now - realLast;
    realLast = now;
    // при перемотке шагаем мелко, чтобы не проскочить пороги
    let left = realDt * speed;
    const acc = [];
    while (left > 0) {
      const dt = Math.min(left, 20 * 1000);
      left -= dt;
      step(dt, idleSec(), acc);
    }
    checkAch(acc);
    render();
  }
  setInterval(tick, 250);

  function setSpeed(s) {
    speed = s;
    card.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', +x.dataset.speed === s));
  }
  card.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  const $away = document.getElementById('dAway');
  $away.addEventListener('click', () => {
    away = !away;
    if (away) awaySim = simNow;
    $away.classList.toggle('on', away);
    $away.textContent = away ? '🪑 Вернуться за компьютер' : '🚶 Отойти от компьютера';
    if (!away) lastInput = Date.now();
  });

  // на съёмке core берёт фразы из генератора с фиксированным зерном — дубли одинаковые
  // (поверх этого director.line ставит фразы сценария)
  function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function resetPet(t, rnd) {
    simNow = t || Date.now();
    pet = Core.createPet(null, settings, simNow, rnd);
    pet.tick(simNow, 0);
    ach = makeAch();
    render();
  }
  document.getElementById('dReset').addEventListener('click', () => { stopFilm(); resetPet(); });
  bar.querySelector('.demo-tray').addEventListener('click', () => {
    const v = pet.view(simNow);
    // как меню-бар в main: «пора пить воду», а не «Вода через 0 мин» (r3-05-05)
    const water = v.waterLeftMin > 0 ? `Вода через ${fmtDur(v.waterLeftMin)}` : 'Пора пить воду';
    const move = v.moveLeftMin > 0 ? `разминка через ${fmtDur(v.moveLeftMin)}` : 'пора размяться';
    emit('event', { type: 'say', text: `${water}, ${move}. Тут в приложении — трофеи, настройки, пауза.` });
  });

  // ---------- действия (как в main) ----------
  function act(type, opts = {}) {
    if (opts.silent && Show && Show.quiet) { Show.quiet(pet, type); render(); return; }
    let ev = null;
    const extra = [];
    if (type === 'drink') ev = pet.drink(simNow);
    else if (type === 'stretch') ev = pet.stretch(simNow);
    else if (type === 'snooze') { pet.snooze(opts.kind, simNow, opts.minutes); extra.push({ type: 'snooze', kind: opts.kind }); }
    else if (type === 'poke') ev = pet.poke();
    else if (type === 'pause' && pet.pause) ev = pet.pause(simNow, opts.minutes || 0);
    else if (type === 'revive') { if (pet.revive && pet.view(simNow).life === 'dead') ev = pet.revive(simNow); else return; }
    else if (type === 'dragged') extra.push({ type: 'dragged' });
    else if (type === 'openTrophies' || type === 'openSettings') {
      const what = type === 'openTrophies' ? '«🏆 Трофеи и статистика»: ачивки, графики и кладбище жаб' : '«⚙️ Настройки»: тайминги, звук и хардкор со смертью';
      emit('event', { type: 'say', text: `В приложении тут откроется окно ${what}.` });
      return;
    }
    if (ev) handle(ev);
    checkAch((ev ? [ev] : []).concat(extra));
    render();
  }

  // ---------- режим съёмки ----------
  let capTimer = null, ffTimer = null;
  function caption(text) {
    clearTimeout(capTimer);
    if (!text) { cap.classList.add('off'); return; }
    cap.textContent = text;
    cap.classList.remove('off');
    capTimer = setTimeout(() => cap.classList.add('off'), Math.max(2600, Math.min(6000, text.length * 120)));
  }

  const ctl = {
    reset() {
      // сцена всегда «в 11 утра», чтобы не ловить ночные ачивки
      const d = new Date(); d.setHours(11, 0, 0, 0);
      resetPet(d.getTime(), seeded(1017));
      filmIdle = 1;
    },
    ff(minutes, idle) {
      filmIdle = idle == null ? 1 : idle;
      let left = Math.max(0, (+minutes || 0) * MIN);
      const acc = [];
      while (left > 0) {
        const dt = Math.min(left, 20 * 1000);
        left -= dt;
        step(dt, filmIdle, acc);
      }
      checkAch(acc);
      render();
      const $ff = document.getElementById('hFF');
      $ff.classList.add('on');
      clearTimeout(ffTimer);
      ffTimer = setTimeout(() => $ff.classList.remove('off', 'on'), 350);
    },
    action: act,
    say(text) { emit('event', { type: 'say', text }); },
    event(ev) { if (ev && ev.type) emit('event', ev); },
    caption,
  };

  const $film = document.getElementById('dFilm');
  const $pick = document.getElementById('dFilmPick');
  function startFilm(name) {
    if (!Show || !scripts[name]) return;
    stopFilm();
    setSpeed(1);
    if ($pick) $pick.value = name;
    director = Show.createDirector(scripts[name], ctl);
    const d = director;
    d.onEnd(() => {
      if (director !== d) return;
      director = null;
      filmIdle = null;
      lastInput = Date.now();
      if ($film) { $film.classList.remove('on'); $film.textContent = '🎬 Сценарий'; }
      setTimeout(() => { if (!director) caption(''); }, 2500);
    });
    if ($film) { $film.classList.add('on'); $film.textContent = '⏹ Стоп'; }
    d.start();
  }
  function stopFilm() { if (director) director.stop(); }
  if ($film) $film.addEventListener('click', () => (director ? stopFilm() : startFilm($pick.value)));
  // ?film=… — сцена сразу «в 11:00» (без скачка часов) и хук почти с первого кадра
  if (q.has('film') && scripts[q.get('film')]) {
    ctl.reset();
    setTimeout(() => startFilm(q.get('film')), 400);
  }

  // ---------- перетаскивание по «рабочему столу» ----------
  let drag = null;

  window.frog = {
    init: () => Promise.resolve({ settings, view: curView() }),
    onView: (cb) => listeners.view.push(cb),
    onEvent: (cb) => listeners.event.push(cb),
    onCursor: (cb) => listeners.cursor.push(cb),
    onSettings: (cb) => listeners.settings.push(cb),
    action(type, opts = {}) { act(type, opts); },
    setIgnore() {},
    dragStart(e) {
      if (SCALED) return; // на сцене жаба стоит по центру
      const r = $pet.getBoundingClientRect();
      drag = { dx: e.screenX - r.left, dy: e.screenY - r.top };
    },
    dragMove(e) {
      if (!drag) return;
      $pet.style.left = Math.max(0, Math.min(innerWidth - 80, e.screenX - drag.dx)) + 'px';
      $pet.style.top = Math.max(0, Math.min(innerHeight - 120, e.screenY - drag.dy)) + 'px';
      $pet.style.right = 'auto'; $pet.style.bottom = 'auto'; $pet.style.marginRight = '0';
    },
    dragEnd() {
      if (drag) act('dragged');
      drag = null;
    },
    // для отладки и автоматической съёмки
    _demo: { ctl, startFilm, stopFilm, get pet() { return pet; }, get director() { return director; } },
  };

})();
