// Браузерное демо: если страница открыта не в Electron, имитируем main-процесс,
// рабочий стол macOS и даём перемотку времени.
(function () {
  'use strict';
  if (window.frog) return;
  const Core = window.FrogCore;
  const MIN = Core.MIN;

  document.documentElement.classList.add('demo');
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
    .demo-card button, .demo-card a.btn { border: 0; border-radius: 10px; padding: 6px 11px; background: #e7efe4; color: #1f2a22; font: 600 13px/1.2 inherit; cursor: pointer; text-decoration: none; }
    .demo-card button.on { background: #3fae5a; color: #fff; }
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
    @media (max-width: 640px) {
      .demo-card { padding: 14px; } .demo-card p.long, .demo-card details { display: none; }
      #pet { right: 50%; margin-right: -130px; }
    }
  `;
  document.head.appendChild(css);

  document.title = 'Жабка — демо питомца-программиста';
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = '<b>Жабка</b><span>Файл</span><span>Правка</span><span class="sp"></span><span class="demo-tray" title="Меню жабки">🐸<span id="dTray"></span></span><span id="dTime"></span>';
  document.body.prepend(bar);

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
    <div class="demo-stats" id="dStats"></div>
    <a class="btn" href="https://github.com/vraiuk/princess-dragon/releases?q=frog" target="_blank" rel="noopener">⬇︎ Скачать для macOS</a>
    <details><summary>Как она считает</summary>
      Вода: стакан пустеет за 45 мин, потом жаба просит пить и начинает сохнуть.
      Движение: через 50 мин сидения — напоминание и каменеет снизу вверх.
      Если 5 минут не трогать мышь и клавиатуру (или заблокировать экран), перерыв засчитывается сам.
    </details>`;
  document.body.appendChild(card);

  const note = document.createElement('div');
  note.className = 'demo-note off';
  document.body.appendChild(note);

  // ---------- имитация main ----------
  let speed = 1, away = false;
  let realLast = Date.now(), simNow = Date.now();
  let lastInput = Date.now();
  const listeners = { view: [], event: [], cursor: [], settings: [] };
  const emit = (k, v) => listeners[k].forEach((cb) => cb(v));
  const settings = Object.assign({}, Core.DEFAULTS);
  let pet = Core.createPet(null, settings, simNow);
  pet.tick(simNow, 0);

  ['mousemove', 'keydown', 'pointerdown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));

  // ?dry=0.8&stone=0.5&activity=away — зафиксировать состояние (для скриншотов)
  const q = new URLSearchParams(location.search);
  function forced() {
    const f = {};
    for (const k of ['dry', 'stone', 'glass']) if (q.has(k)) f[k] = +q.get(k);
    if (q.has('activity')) f.activity = q.get('activity');
    return f;
  }

  function idleSec() {
    if (away) return 3600;
    return (Date.now() - lastInput) / 1000;
  }

  function handle(ev) {
    emit('event', ev);
    if (ev.type === 'remind' && ev.nag >= 2) {
      note.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = ev.kind === 'water' ? '💧 Пора попить воды' : '🤸 Пора размяться';
      note.append(b, document.createTextNode(ev.text));
      note.classList.remove('off');
      setTimeout(() => note.classList.add('off'), 5000);
    }
  }

  function tick() {
    const now = Date.now();
    const realDt = now - realLast;
    realLast = now;
    // при перемотке шагаем мелко, чтобы не проскочить пороги
    let left = realDt * speed;
    while (left > 0) {
      const step = Math.min(left, 20 * 1000);
      simNow += step; left -= step;
      pet.tick(simNow, idleSec()).forEach(handle);
    }
    const v = Object.assign(pet.view(simNow), forced());
    emit('view', v);
    const d = new Date(simNow);
    const hhmm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('dTime').textContent = hhmm;
    document.getElementById('dClock').textContent = hhmm;
    document.getElementById('dTray').textContent = v.paused ? ' ⏸' : (v.needs.water ? ' 💧' : '') + (v.needs.move ? ' 🗿' : '');
    document.getElementById('dStats').textContent =
      `💧 вода через ${v.waterLeftMin} мин · 🧘 сидишь ${v.sitMin} мин · сегодня стаканов ${v.day.drinks}, перерывов ${v.day.breaks}`;
  }
  setInterval(tick, 250);

  card.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    speed = +b.dataset.speed;
    card.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const $away = document.getElementById('dAway');
  $away.addEventListener('click', () => {
    away = !away;
    $away.classList.toggle('on', away);
    $away.textContent = away ? '🪑 Вернуться за компьютер' : '🚶 Отойти от компьютера';
    if (!away) lastInput = Date.now();
  });
  document.getElementById('dReset').addEventListener('click', () => {
    simNow = Date.now(); pet = Core.createPet(null, settings, simNow); pet.tick(simNow, 0);
  });
  bar.querySelector('.demo-tray').addEventListener('click', () => {
    const v = pet.view(simNow);
    emit('event', { type: 'say', text: `Вода через ${v.waterLeftMin} мин, разминка через ${v.moveLeftMin} мин. Это меню-бар: в приложении тут настройки и пауза.` });
  });

  // ---------- перетаскивание по «рабочему столу» ----------
  const $pet = document.getElementById('pet');
  let drag = null;

  window.frog = {
    init: () => Promise.resolve({ settings, view: Object.assign(pet.view(simNow), forced()) }),
    onView: (cb) => listeners.view.push(cb),
    onEvent: (cb) => listeners.event.push(cb),
    onCursor: (cb) => listeners.cursor.push(cb),
    onSettings: (cb) => listeners.settings.push(cb),
    action(type, opts = {}) {
      let ev = null;
      if (type === 'drink') ev = pet.drink(simNow);
      else if (type === 'stretch') ev = pet.stretch(simNow);
      else if (type === 'snooze') pet.snooze(opts.kind, simNow, opts.minutes);
      else if (type === 'poke') ev = pet.poke();
      if (ev) handle(ev);
      emit('view', pet.view(simNow));
    },
    setIgnore() {},
    dragStart(e) {
      const r = $pet.getBoundingClientRect();
      drag = { dx: e.screenX - r.left, dy: e.screenY - r.top };
    },
    dragMove(e) {
      if (!drag) return;
      $pet.style.left = Math.max(0, Math.min(innerWidth - 80, e.screenX - drag.dx)) + 'px';
      $pet.style.top = Math.max(0, Math.min(innerHeight - 120, e.screenY - drag.dy)) + 'px';
      $pet.style.right = 'auto'; $pet.style.bottom = 'auto'; $pet.style.marginRight = '0';
    },
    dragEnd() { drag = null; },
  };

})();
