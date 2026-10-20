// Жаба-программист: всё рисуется кодом на canvas.
(function () {
  'use strict';
  const bridge = window.frog;
  const W = 260, H = 320, OY = 20;        // OY — отступ сверху под облачко
  const FLOOR = 268;                       // линия стола (в координатах раскладки)

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');      // без willReadFrequently: иначе холст уходит на CPU и каждый кадр тянет back/front с GPU
  const back = document.createElement('canvas');   // тело и голова (за ноутбуком)
  const front = document.createElement('canvas');  // лапки (перед ноутбуком)
  const bctx = back.getContext('2d');
  const fctx = front.getContext('2d');
  let dpr = 1;

  const $pet = document.getElementById('pet');
  const $bubble = document.getElementById('bubble');
  const $side = document.getElementById('side');
  const $bDrink = document.getElementById('bDrink');
  const $bMove = document.getElementById('bMove');
  const $bTrophy = document.getElementById('bTrophy');
  const Death = window.FrogDeath || null;

  // ---------- состояние ----------
  let view = { glass: 1, dry: 0, stone: 0, activity: 'coding', needs: {}, day: {}, paused: false, waterLeftMin: 45, moveLeftMin: 50, sitMin: 0 };
  let settings = { sound: true };
  const sm = { dry: 0, stone: 0, glass: 1, crit: 0 };      // сглаженные значения для анимации
  const cursor = { x: 130, y: 400, t: 0 };
  const eye = { x: 0, y: 4 };
  const anim = {};
  let particles = [];
  let blink = { next: 2, t: -1 };
  let glanceUntil = 0, nextGlance = 4;
  let glyphTimer = 0, zTimer = 0, bubbleTimer = null, bubbleKind = null;
  let hover = false, hoverOff = 0, ignoring = true;
  let first = true;
  let fx = null;                                    // что FrogDeath делает с жабой в этом кадре
  let lifeMismatch = 0, syncNow = false;            // рассинхрон view.life и анимации смерти
  let awaitView = 0;                                // после filmEnd ждём свежий view
  let debugPatch = null;                            // __frogDebug.view(patch)

  // ---------- утилиты ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  // детерминированный шум для каменной фактуры
  let seed = 7;
  const srnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const PAL = {
    skin: [[92, 201, 107], [190, 163, 96]],
    dark: [[42, 138, 66], [128, 104, 58]],
    belly: [[205, 240, 160], [232, 216, 170]],
    line: [[24, 64, 36], [84, 62, 30]],
  };

  const STONE = { specks: [], cracks: [], moss: [] };
  for (let i = 0; i < 220; i++) STONE.specks.push({ x: srnd() * W, y: 70 + srnd() * 220, r: 0.6 + srnd() * 2, s: srnd() });
  for (let i = 0; i < 9; i++) {
    let x = 70 + srnd() * 120, y = 110 + srnd() * 150;
    const pts = [[x, y]];
    for (let k = 0; k < 4; k++) { x += (srnd() - 0.5) * 22; y += 4 + srnd() * 12; pts.push([x, y]); }
    STONE.cracks.push(pts);
  }
  for (let i = 0; i < 14; i++) STONE.moss.push({ x: 72 + srnd() * 116, y: 225 + srnd() * 40, r: 4 + srnd() * 7 });
  const DRY_CRACKS = [
    [[112, 106], [118, 118], [114, 126], [121, 134]],
    [[146, 104], [141, 115], [148, 124]],
    [[86, 146], [96, 151], [92, 160]],
    [[172, 144], [164, 152], [170, 161]],
  ];

  function resize() {
    const d = Math.max(1, window.devicePixelRatio || 1);
    if (d === dpr && back.width === Math.round(W * d) && cv.width === back.width) return;
    dpr = d;
    for (const c of [cv, back, front]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    stoneTex = null;
  }
  let stoneTex = null;    // крапинки и трещины камня рисуются один раз в текстуру
  resize();
  window.addEventListener('resize', resize);
  // смена DPR (другой монитор, масштаб жабы) — подписываемся заново на новое значение
  (function watchDpr() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    if (mq.addEventListener) mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true });
  })();

  // ---------- звук «ква» ----------
  // контекст живёт только пока звучит: открытый AudioContext держит аудиопоток ОС (и батарею) вечно
  let actx = null, actxClose = null;
  function croak(vol = 0.18) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      clearTimeout(actxClose);
      actxClose = setTimeout(() => { const c = actx; actx = null; if (c && c.close) c.close().catch(() => {}); }, 1500);
      const t0 = actx.currentTime + 0.02;
      [0, 0.17].forEach((off, i) => {
        const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(i ? 300 : 360, t0 + off);
        o.frequency.exponentialRampToValueAtTime(i ? 170 : 210, t0 + off + 0.13);
        f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
        g.gain.setValueAtTime(0, t0 + off);
        g.gain.linearRampToValueAtTime(vol, t0 + off + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.15);
        o.connect(f).connect(g).connect(actx.destination);
        o.start(t0 + off); o.stop(t0 + off + 0.17);
      });
    } catch (e) { /* без звука */ }
  }

  // ---------- облачко ----------
  // тост ачивки виден (въезжает, висит или уезжает) — облачко ждёт под ним
  function toastUp() {
    const t = document.getElementById('toast');
    return !!t && (t.classList.contains('show') || t.classList.contains('hide'));
  }
  const PRIO = /\b(crit|dead)\b/;
  const bubbleUp = () => !$bubble.classList.contains('hidden');   // облачко на экране (с kind или без)
  function say(text, opts = {}) {
    clearTimeout(bubbleTimer);
    $bubble.querySelector('.txt').textContent = text;
    $bubble.querySelector('.tip').textContent = opts.tip || '';
    const btns = $bubble.querySelector('.btns');
    btns.innerHTML = '';
    (opts.buttons || []).forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.className = b.cls || (b.main ? 'main' : '');
      el.addEventListener('click', (e) => { e.stopPropagation(); hideBubble(); b.do(); });
      btns.appendChild(el);
    });
    // «при смерти» и надгробие с кнопкой важнее тоста: не ждут под ним, тост уезжает вниз (style.css bubble-first)
    $bubble.className = (opts.kind || '') + (!PRIO.test(opts.kind || '') && toastUp() ? ' under-toast' : '');
    // скринридер: «при смерти» — срочно (alert), остальное — вежливо (status)
    const urgent = /\bcrit\b/.test(opts.kind || '');
    $bubble.setAttribute('role', urgent ? 'alert' : 'status');
    $bubble.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    fitBubble();
    kick();
    bubbleKind = opts.kind || null;
    if (opts.ttl !== Infinity) bubbleTimer = setTimeout(hideBubble, opts.ttl || 6000);
  }
  // облачко растёт вверх от головы; если не влезает в окно 260×320 — ужимаем шрифт,
  // режем строки, в крайнем случае опускаем его на макушку
  const BUBBLE_BOTTOM = 214, BUBBLE_TOP_GAP = 4;
  function fitBubble() {
    $bubble.classList.remove('fit1', 'fit2');
    $bubble.style.bottom = '';
    const room = H - BUBBLE_BOTTOM - BUBBLE_TOP_GAP;
    if ($bubble.offsetHeight <= room) return;
    $bubble.classList.add('fit1');
    if ($bubble.offsetHeight <= room) return;
    $bubble.classList.add('fit2');
    const h = $bubble.offsetHeight;
    if (h > room) $bubble.style.bottom = Math.max(150, BUBBLE_BOTTOM - (h - room)) + 'px';
  }
  // говорит облачко: значки над головой его не перебивают
  const speaking = () => !!bubbleKind || bubbleUp();
  function hideBubble() {
    clearTimeout(bubbleTimer);
    $bubble.classList.add('hidden');
    bubbleKind = null;
    // у надгробия облачко с кнопкой возвращается само
    if (isDead()) bubbleTimer = setTimeout(() => { if (Death && Death.mode === 'dead' && !bubbleKind) showRip(); }, 2500);
    else resumeNeeds();
  }

  // ---------- напоминания ----------
  // вода и движение могут прийти разом: показываем одним облачком, «при смерти» важнее обычных.
  // Пока висит другая реплика (тык, «попил»), напоминание ждёт и возвращается после неё.
  const need = {};          // kind -> { ev, crit, until }
  let needTimer = null;
  function clearNeeds() { delete need.water; delete need.move; clearTimeout(needTimer); }
  function addNeed(kind, ev, crit, ttl) {
    const old = need[kind];
    const keep = old && old.crit && !crit && old.until > Date.now();   // обычное не перебивает «при смерти»
    need[kind] = { ev: keep ? old.ev : ev, crit: crit || !!keep, until: Date.now() + ttl, tip: ev.tip || (old && old.tip) };
    showNeeds();
  }
  function needDo(kind) {
    return () => { delete need[kind]; bridge.action(kind === 'water' ? 'drink' : 'stretch'); };
  }
  function showNeeds() {
    clearTimeout(needTimer);
    const t = Date.now();
    for (const k of ['water', 'move']) if (need[k] && (need[k].until <= t || view.paused)) delete need[k];
    const w = need.water, m = need.move;
    if (!w && !m) return false;
    const ttl = Math.max(1000, Math.min(w ? w.until : Infinity, m ? m.until : Infinity) - t);
    const later = (kinds) => () => kinds.forEach((k) => { delete need[k]; bridge.action('snooze', { kind: k }); });
    if (w && m) {
      const crit = w.crit || m.crit;
      say(crit ? (w.crit && m.crit ? 'Я при смерти! Воды и встань! 🥵🗿' : w.crit ? 'Я при смерти! ВОДЫ! 🥵 И размяться бы…' : 'Я почти камень! ВСТАНЬ! 🗿 И попить бы…')
        : 'Двойной дедлайн: попить и размяться!', {
        kind: (crit ? 'crit' : 'water') + ' both', ttl, tip: crit ? '' : (m.tip || m.ev.tip || ''),
        buttons: [
          { label: 'Попил 💧', cls: 'main w', do: needDo('water') },
          { label: 'Размялся 🤸', cls: 'main m', do: needDo('move') },
        ].concat(crit ? [] : [{ label: 'Позже', do: later(['water', 'move']) }]),
      });
      return true;
    }
    const k = w ? 'water' : 'move', n = need[k], ev = n.ev;
    if (n.crit) {
      say(ev.text || (k === 'water' ? 'Я при смерти! ВОДЫ! 🥵' : 'Я почти камень! ВСТАНЬ! 🗿'), {
        kind: 'crit', ttl, tip: k === 'water' ? 'Ещё немного — и я изюм.' : 'Ещё немного — и я памятник.',
        buttons: [{ label: k === 'water' ? 'Попил 💧' : 'Размялся 🤸', main: true, do: needDo(k) }],
      });
    } else {
      say(ev.text, { kind: k, tip: k === 'move' ? n.tip || ev.tip : '', ttl, buttons: [
        { label: k === 'water' ? 'Попил 💧' : 'Размялся 🤸', main: true, do: needDo(k) },
        { label: 'Позже', do: later([k]) },
      ] });
    }
    return true;
  }
  // облачко закрылось — если напоминание ещё ждёт ответа, вернуть его
  function resumeNeeds() {
    clearTimeout(needTimer);
    if (!need.water && !need.move) return;
    needTimer = setTimeout(() => {
      if (alive() && !bubbleKind && $bubble.classList.contains('hidden')) showNeeds();
    }, 700);
  }

  // ---------- смерть ----------
  const alive = () => !Death || Death.mode === 'none';
  const isDead = () => !!Death && Death.isDead();
  const EPITAPH = {
    stone: ['Сидела, пока не стала памятником.', 'Теперь она — часть интерьера.', 'Окаменела за код-ревью. Без перерыва.'],
    dry: ['Засохла в изюм. Вода была в метре.', 'Ушла в пустыню. Стакан стоял рядом.', 'Была жабой, стала изюмом.'],
  };
  function showRip() {
    const inf = (Death && Death.info()) || {};
    const cause = inf.cause === 'dry' ? 'dry' : 'stone';
    // длинная фраза о смерти не лезет над надгробием — тогда короткая эпитафия
    const text = inf.text && inf.text.length <= 64 ? inf.text : EPITAPH[cause][(inf.generation || 1) % 3];
    // причина и срок жизни уже выбиты на надгробии — в облачке только эпитафия и кнопка
    say(text, { kind: 'dead', ttl: Infinity,
      buttons: [{ label: '🥚 Новая жаба', main: true, do: () => bridge.action('revive') }] });
  }
  const deathInfo = (src) => ({ generation: src.generation || view.generation || 1, ageMin: src.ageMin != null ? src.ageMin : view.ageMin, text: src.text });
  function startDeath(ev) {
    if (!Death) return;
    for (const k of Object.keys(anim)) delete anim[k];
    particles = particles.filter((p) => p.kind === 'chunk');
    sm.crit = 0;
    hideBubble();
    lifeMismatch = 0;
    Death.die(ev.cause || view.cause || 'stone', deathInfo(ev));
  }
  function startReborn(ev) {
    if (!Death || Death.mode === 'hatching') return;   // повторный reborn не перезапускает яйцо
    hideBubble();
    lifeMismatch = 0;
    sm.dry = 0; sm.stone = 0; sm.glass = 1;
    Death.reborn({ generation: ev.generation || view.generation, text: ev.text });
  }
  // если view.life не совпадает с тем, что рисуется (старт, сброс, конец съёмки) — подстроиться без анимации
  function syncLife(dt) {
    if (!Death) return;
    if (awaitView) { if (performance.now() - awaitView < 1500) return; awaitView = 0; syncNow = true; }
    const want = view.life === 'dead';
    const m = Death.mode;
    const bad = (want && (m === 'none' || m === 'hatching')) || (!want && (m === 'dead' || m === 'dying'));
    if (!bad) { lifeMismatch = 0; syncNow = false; return; }
    lifeMismatch += dt;
    if (!syncNow && lifeMismatch < 0.7) return;   // ждём событие death/reborn, оно может прийти чуть позже view
    syncNow = false; lifeMismatch = 0;
    particles = [];
    sm.crit = 0;
    if (want) { hideBubble(); Death.setDead(view.cause, deathInfo(view)); showRip(); }
    else { Death.reset(); hideBubble(); sm.dry = view.dry || 0; sm.stone = view.stone || 0; }
  }

  // ---------- титры съёмки ----------
  const $caption = document.getElementById('caption');
  let capTimer = null;
  // любой титр целиком: до 3 строк, шрифт от 18px вниз до 12px; длинное слово тоже не должно вылезать
  const CAP_MAX = 18, CAP_MIN = 12, CAP_LINES = 3;
  function fitCaption() {
    const c = $caption;
    c.classList.remove('clamp');
    const cs = getComputedStyle(c), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    for (let fs = CAP_MAX; fs >= CAP_MIN; fs--) {
      c.style.fontSize = fs + 'px';
      const lh = parseFloat(getComputedStyle(c).lineHeight) || fs * 1.2;
      if (c.scrollWidth <= c.clientWidth + 1 && c.scrollHeight - pad <= lh * CAP_LINES + 1) return;
    }
    c.classList.add('clamp');
  }
  function caption(text) {
    if (!$caption) return;
    clearTimeout(capTimer);
    if (!text) { $caption.classList.add('off'); return; }
    $caption.textContent = text;
    fitCaption();
    $caption.classList.remove('off');
    capTimer = setTimeout(() => $caption.classList.add('off'), Math.max(2600, Math.min(6000, String(text).length * 120)));
  }

  // ---------- события из main ----------
  function onEvent(ev) {
    const now = performance.now() / 1000;
    if (!ev || !ev.type) return;
    kick();
    // пока жаба мертва, обычные реплики не мешают надгробию
    if (isDead() && ['remind', 'drink', 'stretch', 'back', 'poke', 'morning', 'critical'].includes(ev.type)) {
      if (ev.type === 'morning' && Death.mode === 'dead') showRip();
      return;
    }
    switch (ev.type) {
      case 'death':
        clearNeeds();
        startDeath(ev);
        break;
      case 'reborn':
        clearNeeds();
        startReborn(ev);
        break;
      case 'filmEnd':
        // конец съёмки: сбросить анимации и подстроиться под следующий настоящий view без анимаций
        if (Death) Death.reset();
        clearNeeds();
        hideBubble();
        caption('');
        awaitView = performance.now();
        break;
      case 'caption':
        // титр съёмки крупно поверх окна жабы; пустой текст — убрать
        caption(ev.text);
        break;
      case 'visibility':
        // окно спрятано из меню (при backgroundThrottling:false document.hidden не меняется)
        winHidden = !!ev.hidden;
        if (winHidden) stopFrames(); else kick();
        break;
      case 'achievement':
        if (window.FrogToast && FrogToast.show) FrogToast.show(ev);
        else say(`${ev.icon || '🏆'} ${ev.title || 'Ачивка!'}`, { tip: ev.desc, kind: ev.kind === 'bad' ? 'crit' : 'ach', ttl: 5000 });
        break;
      case 'critical':
        if (!ev.quiet) { anim.alert = { t0: now, dur: 2 }; croak(0.22); }
        addNeed(ev.kind === 'water' ? 'water' : 'move', ev, true, 90000);
        break;
      case 'remind':
        if (!ev.quiet) { anim.alert = { t0: now, dur: 1.4 }; croak(); }
        addNeed(ev.kind === 'water' ? 'water' : 'move', ev, false, 90000);
        break;
      case 'drink':
        delete need.water;
        anim.drink = { t0: now, dur: 1.9 };
        say(ev.text, { ttl: 4000 });
        break;
      case 'stretch':
      case 'back':
        delete need.move;
        startJump(now);
        say(ev.text, { ttl: 5000 });
        break;
      case 'paused':
        clearNeeds();
        if (ev.text) say(ev.text, { ttl: 3500 });
        break;
      case 'poke':
        anim.squish = { t0: now, dur: 0.55 };
        croak(0.08);
        say(ev.text, { ttl: 4500 });
        break;
      case 'morning':
        if (!ev.quiet) { anim.alert = { t0: now, dur: 1.4 }; croak(); }
        addNeed('water', ev, false, 120000);
        break;
      default:
        if (ev.text) say(ev.text, { ttl: 3500 });
    }
  }

  function startJump(now) {
    anim.jump = { t0: now, dur: 2.2 };
    const n = Math.round(6 + 40 * sm.stone);
    const line = stoneLine(sm.stone);
    for (let i = 0; i < n; i++) {
      const x = rnd(78, 182), y = rnd(Math.max(line, 100), 250);
      particles.push({ kind: 'chunk', x, y: y + OY, vx: (x - 130) * rnd(0.02, 0.05) + rnd(-1, 1), vy: rnd(-5, -2), life: 0, max: rnd(1, 1.8), size: rnd(2.5, 6), rot: rnd(0, 6), vr: rnd(-6, 6), shade: rnd(0, 1) });
    }
  }

  // ---------- рисование ----------
  const stoneLine = (s) => FLOOR - s * (FLOOR - 82);

  function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

  function frogTransform(g, t) {
    // дыхание; reduce — жаба стоит ровно
    let dy = 0, sx = 1, sy = reduceMotion.matches ? 1 : 1 + 0.012 * Math.sin(t * (view.activity === 'away' ? 1.3 : 2.2)) * (1 - sm.stone);
    if (anim.jump) {
      const p = (t - anim.jump.t0) / anim.jump.dur;
      const ph = (p * 3) % 1;
      dy = -44 * Math.sin(Math.PI * ph) * (1 - p * 0.35);
      const land = ph < 0.12 ? 1 - ph / 0.12 : 0;
      sy *= 1 - 0.1 * land; sx *= 1 + 0.08 * land;
    }
    if (anim.squish) {
      const p = (t - anim.squish.t0) / anim.squish.dur;
      const k = Math.sin(p * Math.PI * 2.5) * (1 - p) * 0.13;
      sy *= 1 - k; sx *= 1 + k * 0.8;
    }
    let rot = 0;
    if (anim.alert) {
      const p = (t - anim.alert.t0) / anim.alert.dur;
      rot = Math.sin(p * Math.PI * 7) * 0.06 * (1 - p);
      dy -= Math.abs(Math.sin(p * Math.PI * 3.5)) * 10 * (1 - p);
    }
    // дрожь: при смерти (critical) и во время гибели
    let shake = fx && fx.shake ? fx.shake : 0;
    const cr = critLevel();
    if (cr > 0 && !reduceMotion.matches) shake = Math.max(shake, (Math.sin(t * 9) > 0.55 ? 1.6 : 0.5) * cr);
    const jx = shake ? rnd(-shake, shake) : 0;
    const jr = shake ? rnd(-shake, shake) * 0.004 : 0;
    g.translate(130 + jx, FLOOR + OY + dy);
    g.rotate(rot + jr);
    g.scale(sx, sy);
    g.translate(-130, -FLOOR);
    if (fx && fx.scale != null) {
      g.translate(fx.ax, fx.ay);
      g.scale(fx.scale * (fx.sx || 1), fx.scale);
      g.translate(-fx.ax, -fx.ay);
    }
  }

  // 0..1 — насколько жаба «при смерти» (сглажено: после «попил» красное гаснет плавно)
  const critLevel = () => (sm.crit > 0.01 ? sm.crit : 0);
  function critTarget() {
    if (!alive() || !view.critical) return 0;
    const c = view.critical, d = view.doom || {};
    let k = 0;
    if (c.water) k = Math.max(k, 0.6 + 0.4 * clamp(((d.water || 0.8) - 0.8) / 0.2, 0, 1));
    if (c.move) k = Math.max(k, 0.6 + 0.4 * clamp(((d.move || 0.8) - 0.8) / 0.2, 0, 1));
    return k;
  }

  function colors() {
    const d = sm.dry;
    return {
      skin: mix(PAL.skin[0], PAL.skin[1], d),
      dark: mix(PAL.dark[0], PAL.dark[1], d),
      belly: mix(PAL.belly[0], PAL.belly[1], d),
      line: mix(PAL.line[0], PAL.line[1], d),
    };
  }

  function drawBack(g, t, C) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    frogTransform(g, t);
    g.lineJoin = 'round'; g.lineCap = 'round';

    // худи
    g.fillStyle = '#2c355c';
    ell(g, 130, 192, 50, 24); g.fill();
    g.strokeStyle = '#151a30'; g.lineWidth = 3;
    ell(g, 130, 232, 64, 44); g.stroke();
    g.fillStyle = '#3d4a7a';
    ell(g, 130, 232, 64, 44); g.fill();
    g.strokeStyle = '#e8ecff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(120, 194); g.lineTo(118, 214); g.moveTo(140, 194); g.lineTo(142, 214); g.stroke();

    // силуэт головы с обводкой
    const shapes = (fn) => {
      ell(g, 130, 150, 64, 46); fn();
      g.beginPath(); g.arc(100, 114, 24, 0, Math.PI * 2); fn();
      g.beginPath(); g.arc(160, 114, 24, 0, Math.PI * 2); fn();
    };
    g.strokeStyle = C.line; g.lineWidth = 5;
    shapes(() => g.stroke());
    g.fillStyle = C.skin;
    shapes(() => g.fill());

    // тень снизу и светлое горлышко
    g.save();
    ell(g, 130, 150, 64, 46); g.clip();
    g.fillStyle = C.dark; g.globalAlpha = 0.35;
    ell(g, 130, 196, 80, 30); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = C.belly;
    ell(g, 130, 186, 44, 20); g.fill();
    g.restore();

    // пятнышки на спинке
    g.fillStyle = C.dark; g.globalAlpha = 0.45;
    ell(g, 82, 134, 6, 4, -0.4); g.fill();
    ell(g, 176, 132, 7, 4.5, 0.4); g.fill();
    ell(g, 186, 150, 4, 3, 0.2); g.fill();
    g.globalAlpha = 1;

    // наушники: дуга за глазами (при вылуплении падают сверху)
    const phones = !(fx && fx.hidePhones);
    const pdy = fx && fx.phonesDY ? fx.phonesDY : 0;
    if (phones) {
      // светлый кант — чтобы тёмные наушники не терялись на тёмных обоях
      g.strokeStyle = 'rgba(205,215,240,.7)'; g.lineWidth = 12.5;
      g.beginPath(); g.arc(130, 152 + pdy, 76, Math.PI * 1.07, Math.PI * 1.93); g.stroke();
      g.strokeStyle = '#1f2330'; g.lineWidth = 9;
      g.beginPath(); g.arc(130, 152 + pdy, 76, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
      g.strokeStyle = '#4a5268'; g.lineWidth = 3;
      g.beginPath(); g.arc(130, 152 + pdy, 76, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
    }

    // глаза
    const sleeping = view.activity === 'away';
    let lid = 0.08 + sm.dry * 0.38;
    if (blink.t >= 0) lid = Math.max(lid, 1 - Math.abs(blink.t - 0.07) / 0.07);
    if (sleeping) lid = 1;
    if (sm.stone > 0.93) lid = Math.max(lid, 0.3);
    for (const ex of [100, 160]) drawEye(g, ex, 114, lid, C, sleeping);

    // наушники: чашки поверх
    const led = view.paused ? '#ff5d5d' : view.activity === 'coding' ? '#6ee7b7' : '#8aa0ff';
    for (const [x, dir] of phones ? [[62, -1], [198, 1]] : []) {
      g.strokeStyle = 'rgba(205,215,240,.7)'; g.lineWidth = 3;
      rr(g, x - 9, 132 + pdy, 18, 38, 8); g.stroke();
      g.fillStyle = '#1f2330';
      rr(g, x - 9, 132 + pdy, 18, 38, 8); g.fill();
      g.fillStyle = '#343b50';
      rr(g, x - 5 - dir * 2, 136 + pdy, 10, 30, 5); g.fill();
      g.fillStyle = led;
      g.beginPath(); g.arc(x + dir * 4, 141 + pdy, 2.2, 0, Math.PI * 2); g.fill();
    }

    // ноздри
    g.fillStyle = C.line;
    ell(g, 123, 138, 2.2, 1.5); g.fill();
    ell(g, 137, 138, 2.2, 1.5); g.fill();

    // щёчки
    g.fillStyle = `rgba(255,120,140,${0.35 * (1 - sm.dry) * (1 - sm.stone)})`;
    ell(g, 86, 160, 11, 6); g.fill();
    ell(g, 174, 160, 11, 6); g.fill();

    // свечение экрана на мордочке: только по силуэту (source-atop) и до рта — язык остаётся розовым;
    // камень не светится
    const glow = (view.activity === 'coding' ? 0.38 : view.activity === 'thinking' ? 0.2 : 0) * (1 - sm.stone);
    if (glow > 0.01 && alive()) {
      g.globalCompositeOperation = 'source-atop';
      const gr = g.createLinearGradient(0, 200, 0, 120);
      gr.addColorStop(0, `rgba(120,200,255,${glow})`);
      gr.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 100, W, 140);
      g.globalCompositeOperation = 'source-over';
    }

    drawMouth(g, t, C);

    // блеск влажной кожи
    g.fillStyle = `rgba(255,255,255,${0.38 * (1 - sm.dry)})`;
    ell(g, 102, 132, 13, 4.5, -0.25); g.fill();
    ell(g, 88, 100, 6, 3, -0.7); g.fill();
    ell(g, 148, 98, 6, 3, -0.7); g.fill();

    drawWrinkles(g, C);

    applyStone(g, t);
    // тёмный контур камня по внешнему краю силуэта (destination-over: внутренние дуги глаз прячутся под головой)
    if (sm.stone > 0.5) {
      g.save();
      g.globalCompositeOperation = 'destination-over';
      g.strokeStyle = `rgba(46,48,44,${clamp((sm.stone - 0.5) * 2, 0, 1) * 0.9})`; g.lineWidth = 7;
      shapes(() => g.stroke());
      g.restore();
    }
    applyCrit(g, t);
    if (Death) Death.decorate(g, t, 'back');
    g.restore();
  }

  // красноватый тревожный отлив «при смерти», пульсирует как сердцебиение
  // сердцебиение «при смерти»; reduce — ровный уровень без пульса
  function heartbeat(t) { if (reduceMotion.matches) return 0.5; const p = (t * 1.25) % 1; return Math.max(Math.exp(-Math.pow((p - 0.08) / 0.05, 2)), 0.7 * Math.exp(-Math.pow((p - 0.28) / 0.05, 2))); }
  function applyCrit(g, t) {
    const cr = critLevel();
    if (!cr) return;
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const gr = g.createRadialGradient(130, 160, 30, 130, 160, 120);
    gr.addColorStop(0, `rgba(255,40,40,${0.04 * cr})`);
    gr.addColorStop(1, `rgba(255,30,50,${(0.22 + 0.22 * heartbeat(t)) * cr})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function drawEye(g, ex, ey, lid, C, sleeping) {
    g.fillStyle = '#fffef6';
    g.beginPath(); g.arc(ex, ey, 17, 0, Math.PI * 2); g.fill();
    if (!sleeping) {
      const px = ex + eye.x, py = ey + eye.y;
      g.fillStyle = '#18201a';
      g.beginPath(); g.arc(px, py, 8.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(px - 3, py - 3.2, 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px + 3, py + 3, 1.2, 0, Math.PI * 2); g.fill();
    }
    // веко
    if (lid > 0.01) {
      g.save();
      g.beginPath(); g.arc(ex, ey, 17.5, 0, Math.PI * 2); g.clip();
      g.fillStyle = C.skin;
      const yb = ey - 17 + 34 * lid;
      g.beginPath();
      g.moveTo(ex - 20, ey - 20);
      g.lineTo(ex + 20, ey - 20);
      g.lineTo(ex + 20, yb);
      g.quadraticCurveTo(ex, yb + 5 * (lid < 0.95 ? 1 : 0.2), ex - 20, yb);
      g.fill();
      g.strokeStyle = C.line; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(ex - 20, yb);
      g.quadraticCurveTo(ex, yb + 5 * (lid < 0.95 ? 1 : 0.2), ex + 20, yb);
      g.stroke();
      g.restore();
    }
    g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath(); g.arc(ex, ey, 17, 0, Math.PI * 2); g.stroke();
  }

  function drawMouth(g, t, C) {
    g.strokeStyle = C.line; g.lineWidth = 3; g.lineCap = 'round';
    const happy = anim.drink || anim.jump || anim.squish || (fx && fx.happy);
    if (view.activity === 'away') {
      g.fillStyle = C.line;
      ell(g, 130, 163, 4, 3 + (reduceMotion.matches ? 0 : Math.sin(t * 1.3))); g.fill();
    } else if (sm.stone > 0.6 && !happy) {
      g.beginPath(); g.moveTo(108, 163); g.lineTo(152, 163); g.stroke();
    } else if (happy) {
      g.fillStyle = '#5a1f2a';
      g.beginPath(); g.moveTo(104, 158); g.quadraticCurveTo(130, 192, 156, 158); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff7f96';
      ell(g, 130, 172, 9, 5); g.fill();
    } else if (sm.dry > 0.45) {
      const k = clamp((sm.dry - 0.45) / 0.55, 0, 1);
      g.fillStyle = '#4a1d22';
      ell(g, 130, 164, 13, 5 + 3 * k); g.fill(); g.stroke();
      g.fillStyle = '#e8728a';
      const len = 8 + 16 * k + (reduceMotion.matches ? 0 : Math.sin(t * 3) * 1.5);   // reduce: язык не качается
      g.beginPath();
      g.moveTo(123, 165); g.lineTo(123, 165 + len);
      g.arc(130, 165 + len, 7, Math.PI, 0, true);
      g.lineTo(137, 165); g.closePath(); g.fill();
      g.strokeStyle = '#b84a62'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(130, 168); g.lineTo(130, 162 + len); g.stroke();
    } else if (view.activity === 'thinking') {
      // «хм»: рот набок
      g.beginPath(); g.moveTo(114, 163); g.quadraticCurveTo(134, 160, 150, 154); g.stroke();
    } else if (view.activity === 'coding') {
      g.beginPath(); g.moveTo(108, 160); g.quadraticCurveTo(130, 172, 152, 160); g.stroke();
      // кончик языка от сосредоточенности
      g.fillStyle = '#ff8fa3';
      ell(g, 148, 164, 3.5, 2.5, 0.4); g.fill();
    } else {
      g.beginPath(); g.moveTo(100, 158); g.quadraticCurveTo(130, 178, 160, 158); g.stroke();
    }
  }

  function drawWrinkles(g, C) {
    const a = clamp((sm.dry - 0.15) * 1.4, 0, 1);
    if (a <= 0) return;
    g.save();
    g.strokeStyle = C.line; g.globalAlpha = a * 0.7; g.lineWidth = 1.5;
    const arcs = [[130, 124, 9, 1.15, 1.85], [130, 131, 12, 1.2, 1.8], [100, 132, 12, 0.2, 0.8], [160, 132, 12, 0.2, 0.8],
      [84, 170, 9, 1.4, 1.95], [176, 170, 9, 1.05, 1.6], [130, 108, 14, 1.25, 1.75]];
    for (const [x, y, r, s, e] of arcs) { g.beginPath(); g.arc(x, y, r, Math.PI * s, Math.PI * e); g.stroke(); }
    if (sm.dry > 0.6) {
      g.globalAlpha = clamp((sm.dry - 0.6) / 0.3, 0, 1) * 0.8;
      g.lineWidth = 1.3;
      for (const pts of DRY_CRACKS) {
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
        g.stroke();
      }
    }
    g.restore();
  }

  function applyStone(g, t) {
    const s = sm.stone;
    if (s < 0.004) return;
    const y0 = stoneLine(s);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.beginPath();
    g.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 6) g.lineTo(x, y0 + 4 * Math.sin(x * 0.13 + 1.7) + 2.5 * Math.sin(x * 0.37));
    g.lineTo(W + 10, H);
    g.closePath();
    g.clip();
    const gr = g.createLinearGradient(0, y0, 0, FLOOR);
    // плотный камень: тёмнее и непрозрачнее, иначе окаменевшая жаба выглядит выцветшим призраком
    gr.addColorStop(0, '#a4a59d'); gr.addColorStop(1, '#6f706a');
    g.globalAlpha = 0.93;
    g.fillStyle = gr;
    g.fillRect(-10, y0 - 10, W + 20, H);
    g.globalAlpha = 1;
    g.drawImage(stoneTexture(), 0, 0, W, H);
    if (s > 0.7) {
      g.globalAlpha = (s - 0.7) / 0.3;
      for (const m of STONE.moss) {
        g.fillStyle = '#6f8f3e';
        g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8fae55';
        g.beginPath(); g.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 6) g.lineTo(x, y0 + 1.5 + 4 * Math.sin(x * 0.13 + 1.7) + 2.5 * Math.sin(x * 0.37));
    g.stroke();
    g.restore();
  }

  // 220 крапинок и трещины каждый кадр на двух слоях — дорого; рисуем один раз
  function stoneTexture() {
    if (stoneTex) return stoneTex;
    stoneTex = document.createElement('canvas');
    stoneTex.width = Math.round(W * dpr); stoneTex.height = Math.round(H * dpr);
    const g = stoneTex.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const p of STONE.specks) {
      g.fillStyle = p.s > 0.5 ? 'rgba(60,60,58,.45)' : 'rgba(235,235,228,.45)';
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(50,50,48,.7)'; g.lineWidth = 1.3;
    for (const pts of STONE.cracks) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
    }
    return stoneTex;
  }

  function drawFront(g, t, C) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    frogTransform(g, t);
    const typing = view.activity === 'coding' && sm.stone < 0.85 && !anim.jump && !reduceMotion.matches;   // reduce: лапки не стучат
    const tap = (ph) => (typing ? -3.5 * Math.max(0, Math.sin(t * 17 + ph)) : 0);
    const jumpArms = anim.jump ? -14 : 0;
    for (const [x, ph, dir] of [[90, 0, -1], [170, Math.PI * 0.9, 1]]) {
      const y = 196 + tap(ph) + jumpArms;
      // рукав
      g.fillStyle = '#3d4a7a'; g.strokeStyle = '#151a30'; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x + dir * 22, 214);
      g.quadraticCurveTo(x + dir * 18, y + 2, x + dir * 6, y + 4);
      g.lineTo(x - dir * 6, y + 6);
      g.quadraticCurveTo(x + dir * 4, 222, x + dir * 22, 226);
      g.fill(); g.stroke();
      // лапка с пальчиками
      g.fillStyle = C.skin; g.strokeStyle = C.line; g.lineWidth = 2.2;
      for (const fx of [-8, 0, 8]) {
        g.beginPath(); g.arc(x + fx, y + 1 - (fx === 0 ? 1.5 : 0), 5, 0, Math.PI * 2); g.stroke();
      }
      ell(g, x, y + 5, 13, 7.5); g.stroke();
      ell(g, x, y + 5, 13, 7.5); g.fill();
      for (const fx of [-8, 0, 8]) {
        g.beginPath(); g.arc(x + fx, y + 1 - (fx === 0 ? 1.5 : 0), 5, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = `rgba(255,255,255,${0.35 * (1 - sm.dry)})`;
      for (const fx of [-8, 0, 8]) { g.beginPath(); g.arc(x + fx - 1.5, y - 1, 1.4, 0, Math.PI * 2); g.fill(); }
    }
    applyStone(g, t);
    applyCrit(g, t);
    if (Death) Death.decorate(g, t, 'front');
    g.restore();
  }

  function drawLaptop(g, t) {
    g.save();
    g.translate(0, OY);
    // свет экрана рисуется только на мордочке (drawBack): эллипс за крышкой торчал ореолом на тёмных обоях
    // крышка
    g.beginPath();
    g.moveTo(84, 194); g.lineTo(176, 194);
    g.quadraticCurveTo(182, 194, 183, 200);
    g.lineTo(186, 254); g.quadraticCurveTo(186, 260, 180, 260);
    g.lineTo(80, 260); g.quadraticCurveTo(74, 260, 74, 254);
    g.lineTo(77, 200); g.quadraticCurveTo(78, 194, 84, 194);
    g.closePath();
    const gr = g.createLinearGradient(0, 194, 0, 260);
    gr.addColorStop(0, '#e4e8ee'); gr.addColorStop(1, '#aeb5c1');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#4b5263'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(86, 197); g.lineTo(174, 197); g.stroke();
    // стикеры
    g.fillStyle = '#1f2433';
    rr(g, 106, 214, 48, 24, 7); g.fill();
    g.fillStyle = '#6ee7b7';
    g.font = 'bold 14px Menlo, Monaco, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('</>', 130, 226.5);
    g.save();
    g.translate(162, 247); g.rotate(0.25);
    g.fillStyle = '#ff7aa8';
    rr(g, -10, -6, 20, 12, 4); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 8px -apple-system, sans-serif';
    g.fillText('git', 0, 0.5);
    g.restore();
    g.fillStyle = '#ffd25a';
    g.beginPath(); g.arc(94, 246, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a5a00'; g.font = 'bold 8px sans-serif'; g.fillText('JS', 94, 246.5);
    // основание
    g.fillStyle = '#8e95a2';
    rr(g, 62, 259, 136, 8, 4); g.fill();
    g.strokeStyle = '#4b5263'; g.lineWidth = 1.5; g.stroke();
    g.restore();
  }

  function drawGlass(g, t) {
    g.save();
    g.translate(0, OY);
    const x0 = 200, x1 = 234, y0 = 214, y1 = 266, bx0 = 203, bx1 = 231;
    const path = () => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(bx1, y1); g.quadraticCurveTo(217, y1 + 3, bx0, y1); g.closePath(); };
    path();
    g.fillStyle = 'rgba(225,240,255,0.22)'; g.fill();
    // вода
    g.save(); path(); g.clip();
    const lvl = sm.glass;
    if (lvl > 0.01) {
      const top = y1 - 2 - lvl * (y1 - y0 - 6);
      g.beginPath();
      g.moveTo(x0 - 2, H);
      for (let x = x0 - 2; x <= x1 + 2; x += 2) g.lineTo(x, top + Math.sin(x * 0.4 + t * 3) * 1.2);
      g.lineTo(x1 + 2, H); g.closePath();
      const wg = g.createLinearGradient(0, top, 0, y1);
      wg.addColorStop(0, 'rgba(110,190,255,0.85)'); wg.addColorStop(1, 'rgba(40,120,220,0.9)');
      g.fillStyle = wg; g.fill();
      g.strokeStyle = 'rgba(220,245,255,.9)'; g.lineWidth = 1.5;
      g.beginPath();
      for (let x = x0 - 2; x <= x1 + 2; x += 2) g.lineTo(x, top + Math.sin(x * 0.4 + t * 3) * 1.2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.6)';
      for (let i = 0; i < 3; i++) {
        const by = y1 - ((t * 14 + i * 17) % Math.max(4, y1 - top - 2));
        g.beginPath(); g.arc(208 + i * 8, by, 1.3, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    path();
    g.strokeStyle = 'rgba(30,45,70,.65)'; g.lineWidth = 3.5; g.stroke();
    g.strokeStyle = 'rgba(245,252,255,.95)'; g.lineWidth = 1.8; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(205, 220); g.lineTo(207, 258); g.stroke();
    g.restore();
  }

  function drawEffects(g, t, dt) {
    const rm = reduceMotion.matches;   // меньше движения: значки и жар стоят, без пульса и бегущих точек
    const ta = rm ? 0 : t;
    const quiet = speaking();
    // жар над пересохшей жабой: светлая подложка под оранжевым — видно и на тёмных, и на светлых обоях
    if (sm.dry > 0.5 && (alive() || (fx && fx.show && (fx.scale == null || fx.scale > 0.7)))) {
      const a = Math.min(1, (sm.dry - 0.5) * 2.2);
      g.save();
      g.lineCap = 'round';
      for (const [col, lw] of [[`rgba(255,226,170,${0.45 * a})`, 4], [`rgba(255,150,40,${0.9 * a})`, 2]]) {
        g.strokeStyle = col; g.lineWidth = lw;
        for (const x of [104, 130, 156]) {
          g.beginPath();
          for (let k = 0; k <= 12; k++) {
            const y = 90 + OY - k * 2.2 - ((ta * 12) % 8);
            g.lineTo(x + Math.sin(k * 0.9 + ta * 4 + x) * 3, y);
          }
          g.stroke();
        }
      }
      g.restore();
    }

    // «при смерти»: тревожный значок с пульсирующими кольцами
    const cr = critLevel();
    if (critTarget() && !quiet) {
      const hb = heartbeat(t);
      const x = 130, y = 66 + OY + Math.sin(ta * 3) * 2;
      g.save();
      for (const ph of [0, 0.5]) {
        const k = rm ? 0.2 + ph : (t * 0.9 + ph) % 1;
        g.strokeStyle = `rgba(255,60,60,${0.7 * (1 - k)})`; g.lineWidth = 2.5 * (1 - k) + 0.5;
        ell(g, x, y, 14 + k * 22, 14 + k * 22); g.stroke();
      }
      const r = 13 + hb * 3;
      g.fillStyle = '#e8343f'; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
      ell(g, x, y, r, r); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 18px -apple-system, "Helvetica Neue", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('!', x, y + 1);
      const icon = view.critical.water && view.critical.move ? '🥵🗿' : view.critical.water ? '🥵' : '🗿';
      g.font = '15px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      g.fillText(icon, x + 30, y + 2);
      g.restore();
    }
    // капли пота от ужаса
    if (critTarget() && !rm && Math.random() < 0.06) particles.push({ kind: 'drop', x: rnd(80, 180), y: rnd(110, 140) + OY, vx: rnd(-0.6, 0.6), vy: rnd(-1.5, 0), size: rnd(1.6, 2.6), life: 0, max: 0.7 });

    // думает: облачко мысли с бегущими точками справа над головой.
    // Не поверх реплики (она может быть и без kind) и не у камня или изюма — те не думают
    if (view.activity === 'thinking' && alive() && !cr && !quiet && sm.stone < 0.5 && sm.dry < 0.5 && !(view.needs.water || view.needs.move)) {
      g.save();
      g.fillStyle = 'rgba(255,253,245,.95)'; g.strokeStyle = '#1d3b26'; g.lineWidth = 1.5;
      ell(g, 186, 82 + OY, 3, 3); g.fill(); g.stroke();
      ell(g, 194, 70 + OY, 4.5, 4.5); g.fill(); g.stroke();
      rr(g, 192, 38 + OY, 44, 22, 11); g.fill(); g.stroke();
      for (let i = 0; i < 3; i++) {
        const on = rm || Math.floor(t * 2.5) % 4 > i;
        g.fillStyle = on ? '#1f2a22' : 'rgba(31,42,34,.25)';
        ell(g, 203 + i * 11, 49 + OY, 2.6, 2.6); g.fill();
      }
      g.restore();
    }

    // значок нужды над головой
    if (!cr && alive() && !quiet && (view.needs.water || view.needs.move) && view.activity !== 'away') {
      const icon = view.needs.water && view.needs.move ? '💧🗿' : view.needs.water ? '💧' : '🗿';
      g.save();
      g.globalAlpha = 0.85 + 0.15 * Math.sin(ta * 4);
      g.font = `${20 + 2 * Math.sin(ta * 4)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(icon, 130, 64 + OY + Math.sin(ta * 2.5) * 3);
      g.restore();
    }

    // частицы
    const keep = [];
    for (const p of particles) {
      p.life += dt;
      if (p.life > p.max) continue;
      keep.push(p);
      const a = 1 - p.life / p.max;
      if (p.kind === 'glyph') {
        p.y -= 16 * dt; p.x += Math.sin(p.life * 3 + p.ph) * 6 * dt;
        g.globalAlpha = Math.min(1, a * 1.5) * 0.9;
        g.fillStyle = p.color;
        g.font = `bold ${p.size}px Menlo, Monaco, monospace`;
        g.textAlign = 'center';
        // тёмная обводка — светлые символы видны и на белых обоях
        g.strokeStyle = 'rgba(16,24,40,.55)'; g.lineWidth = 2.5; g.lineJoin = 'round';
        g.strokeText(p.text, p.x, p.y);
        g.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'z') {
        p.y -= 12 * dt; p.x += 8 * dt;
        g.globalAlpha = a; g.fillStyle = '#e8ecff';
        g.strokeStyle = '#1d2a4a'; g.lineWidth = 3;
        g.font = `bold ${p.size}px -apple-system, sans-serif`;
        g.strokeText('z', p.x, p.y); g.fillText('z', p.x, p.y);
      } else if (p.kind === 'chunk') {
        p.vy += 14 * dt; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; p.rot += p.vr * dt;
        if (p.y > FLOOR + OY) { p.y = FLOOR + OY; p.vy *= -0.35; p.vx *= 0.6; }
        g.globalAlpha = Math.min(1, a * 2);
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.shade > 0.5 ? '#8e8f88' : '#b3b4ad';
        g.strokeStyle = '#55564f'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-p.size, -p.size * 0.6); g.lineTo(p.size * 0.8, -p.size); g.lineTo(p.size, p.size * 0.7); g.lineTo(-p.size * 0.5, p.size); g.closePath();
        g.fill(); g.stroke();
        g.restore();
      } else if (p.kind === 'drop') {
        p.vy += 9.8 * dt * 60 * 0.12; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
        g.globalAlpha = Math.min(1, a * 2);
        g.fillStyle = '#5fb4ff'; g.strokeStyle = '#1e5fa8'; g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.8)';
        g.beginPath(); g.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.35, 0, Math.PI * 2); g.fill();
      } else if (p.kind === 'spark') {
        const s = p.size * Math.sin(Math.PI * p.life / p.max);
        g.globalAlpha = 1; g.fillStyle = p.color;
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const r = k % 2 ? s * 0.35 : s, an = k * Math.PI / 4;
          g.lineTo(p.x + Math.cos(an) * r, p.y + Math.sin(an) * r);
        }
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
    }
    particles = keep;
  }

  // ---------- кадр ----------
  // Кадр планируется таймером ровно на нужный шаг: раньше rAF будил рендер 60 раз/с даже при цели 12 fps.
  // Окно спрятано — кадров нет вовсе.
  let lastT = performance.now() / 1000, frames = 0;
  let frameTimer = null, nextAt = 0, started = false, winHidden = false;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hiddenNow = () => winHidden || document.hidden;
  function frameStep() {
    const away = view.activity === 'away';
    const calm = !Object.keys(anim).length && !drag;
    const quiet = calm && !hover && (!Death || Death.mode === 'none');
    // надгробие стоит: 2 кадра/с хватает на цветы и случайный тык (тык будит кадры сразу)
    if (calm && !critLevel() && Death && Death.mode === 'dead' && !particles.length && !(Death.stats && Death.stats().parts)) return 1 / 2;
    // при смерти, но человек отошёл: тревога видна, но без 30 fps часами
    if (critLevel()) return calm && away ? 1 / 12 : 1 / 30;
    if (quiet && away) return 1 / 8;
    if (quiet && view.activity === 'coding') return 1 / 20;   // столько и выходило при rAF с пропуском кадров
    return quiet ? 1 / 15 : 1 / 30;
  }
  function schedule(step) {
    if (!started || hiddenNow() || frameTimer) return;
    nextAt = performance.now() + step * 1000;
    // рисуем прямо из таймера: холст покажется на ближайшем vsync, а лишний rAF только округлял fps вверх
    frameTimer = setTimeout(() => { frameTimer = null; frame(); }, step * 1000);
  }
  function stopFrames() {
    clearTimeout(frameTimer); frameTimer = null;
  }
  // что-то поменялось (событие, мышь, view): следующий кадр не позже чем через 1/30 с
  function kick() {
    if (!started || hiddenNow()) return;
    if (frameTimer && nextAt - performance.now() > 40) { clearTimeout(frameTimer); frameTimer = null; }
    schedule(1 / 30);
  }
  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.15, t - lastT);   // 8 fps во сне — шаг 0.125 с проходит без замедления
    lastT = t;
    frames++;
    update(t, dt);
    render(t, dt);
    schedule(frameStep());
  }
  document.addEventListener('visibilitychange', () => { if (hiddenNow()) stopFrames(); else { lastT = performance.now() / 1000; kick(); } });

  function update(t, dt) {
    for (const k of Object.keys(anim)) if (t - anim[k].t0 > anim[k].dur) delete anim[k];

    syncLife(dt);
    fx = Death ? Death.frogFx(t) : null;
    const fast = anim.jump || anim.drink;
    // reduce: переходы сухости и камня короче — без долгого «ползущего» перекрашивания
    const rate = first ? 1 : 1 - Math.exp(-dt * (fast ? 2.2 : 0.9) * (reduceMotion.matches ? 3 : 1));
    first = false;
    const r2 = 1 - Math.exp(-dt * 4);
    sm.dry = fx && fx.dry != null ? lerp(sm.dry, fx.dry, r2) : lerp(sm.dry, view.dry || 0, anim.drink ? rate * 0.6 : rate);
    sm.stone = fx && fx.stone != null ? lerp(sm.stone, fx.stone, r2) : lerp(sm.stone, view.stone || 0, rate);
    const ct = critTarget();
    sm.crit = first || ct > sm.crit ? ct : lerp(sm.crit, ct, 1 - Math.exp(-dt * 2.5));
    sm.glass = lerp(sm.glass, anim.drink && t - anim.drink.t0 < 0.9 ? Math.max(0, sm.glass - 0.02) : view.glass, rate);

    // моргание
    if (blink.t >= 0) { blink.t += dt; if (blink.t > 0.14) blink.t = -1; }
    else if ((blink.next -= dt) <= 0) { blink.t = 0; blink.next = rnd(2.5, 6.5) * (Math.random() < 0.2 ? 0.15 : 1); }

    // куда смотрят глаза
    let tx, ty;
    const cursorFresh = performance.now() - cursor.t < 3000;
    if ((nextGlance -= dt) <= 0) { glanceUntil = t + rnd(0.8, 1.6); nextGlance = rnd(5, 11); }
    if (anim.drink) { tx = 216; ty = 230 + OY; }
    else if (view.activity === 'coding' && t > glanceUntil) { tx = 130; ty = 260 + OY; }
    else if (view.activity === 'thinking' && !cursorFresh) { tx = 215; ty = 20 + OY; }
    else if (cursorFresh) { tx = cursor.x; ty = cursor.y; }
    else { tx = reduceMotion.matches ? 130 : 130 + Math.sin(t * 0.4) * 120; ty = 140 + OY; }   // reduce: взгляд не бродит
    const dx = tx - 130, dy = ty - (114 + OY), d = Math.hypot(dx, dy) || 1;
    const m = Math.min(6, d * 0.04);
    const frozen = sm.stone > 0.93;
    if (!frozen) {
      eye.x = lerp(eye.x, (dx / d) * m, 1 - Math.exp(-dt * 10));
      eye.y = lerp(eye.y, (dy / d) * m, 1 - Math.exp(-dt * 10));
    }

    // частицы-эмиттеры
    // reduce: без летящих символов кода — «пишет код» видно по свечению экрана
    if (view.activity === 'coding' && sm.stone < 0.85 && !anim.jump && alive() && !reduceMotion.matches) {
      if ((glyphTimer -= dt) <= 0) {
        glyphTimer = rnd(0.5, 1.1);
        const glyphs = ['{ }', '</>', ';', '=>', '()', '[]', '&&', '!=', 'fn', '01', '++', '#', '$', '//', '?.'];
        const cols = ['#6ee7b7', '#7cc4ff', '#ffd25a', '#ff9ac4', '#c4a7ff'];
        particles.push({ kind: 'glyph', x: Math.random() < 0.5 ? rnd(66, 86) : rnd(174, 194), y: 200 + OY, text: glyphs[Math.floor(Math.random() * glyphs.length)], color: cols[Math.floor(Math.random() * cols.length)], size: rnd(9, 12), life: 0, max: rnd(1.6, 2.4), ph: rnd(0, 6) });
      }
    }
    if (view.activity === 'away' && alive() && (zTimer -= dt) <= 0) {
      zTimer = 1.3;
      particles.push({ kind: 'z', x: 168, y: 96 + OY, size: rnd(12, 18), life: 0, max: 2.6 });
    }
    if (anim.drink) {
      const p = (t - anim.drink.t0) / anim.drink.dur;
      if (p < 0.55) {
        for (let i = 0; i < 2; i++) {
          // струйка из стакана в рот по параболе
          const sx = 214 + rnd(-3, 3), sy = 212 + OY, tx2 = 130 + rnd(-6, 6), ty2 = 164 + OY, T = 22;   // невысокая дуга: на уровне глаз, а не фонтан над головой
          particles.push({ kind: 'drop', x: sx, y: sy, vx: (tx2 - sx) / T, vy: (ty2 - sy) / T - 0.5 * 9.8 * 0.12 * T, size: rnd(2, 3.4), life: 0, max: T / 60 });
        }
      } else if (Math.random() < 0.5) {
        particles.push({ kind: 'spark', x: rnd(70, 190), y: rnd(90, 200) + OY, size: rnd(4, 8), color: Math.random() < 0.5 ? '#bfe6ff' : '#ffffff', life: 0, max: rnd(0.4, 0.8) });
      }
    }
  }

  function render(t, dt) {
    const C = colors();
    const showFrog = !fx || fx.show;
    if (showFrog) {
      drawBack(bctx, t, C);
      drawFront(fctx, t, C);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // красное тревожное свечение за жабой
    const cr = critLevel();
    if (cr) {
      const a = (0.25 + 0.35 * heartbeat(t)) * cr;
      const gr = ctx.createRadialGradient(130, 150 + OY, 20, 130, 150 + OY, 125);
      gr.addColorStop(0, `rgba(255,50,50,${a})`); gr.addColorStop(0.6, `rgba(255,40,60,${a * 0.4})`); gr.addColorStop(1, 'rgba(255,40,60,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    // тень на столе
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ell(ctx, 136, FLOOR + OY + 2, 106, 9); ctx.fill();
    if (Death) Death.drawBehind(ctx, t, dt);
    const fa = fx && fx.alpha != null ? fx.alpha : 1;
    if (showFrog && fa > 0) {
      ctx.globalAlpha = fa;
      ctx.drawImage(back, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    drawLaptop(ctx, t);
    if (showFrog && fa > 0) {
      ctx.globalAlpha = fa;
      ctx.drawImage(front, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    drawGlass(ctx, t);
    if (Death) Death.drawFront(ctx, t, dt);
    drawEffects(ctx, t, dt);
    updateSide();
  }

  // ---------- кнопки сбоку ----------
  let sideStamp = '';
  function updateSide() {
    // пока висит тост ачивки, облачко прячется под него и возвращается после
    const prio = bubbleUp() && PRIO.test($bubble.className);
    $bubble.classList.toggle('under-toast', !prio && toastUp());
    $pet.classList.toggle('bubble-first', prio);
    $pet.classList.toggle('away', view.activity === 'away');   // CSS-тряска «при смерти» не крутится, пока человека нет
    const dead = !alive();
    const stamp = [view.waterLeftMin, view.moveLeftMin, view.needs.water, view.needs.move, hover, dead].join();
    if (stamp === sideStamp) return;
    sideStamp = stamp;
    $bDrink.style.setProperty('--p', clamp(view.glass, 0, 1).toFixed(3));
    $bMove.style.setProperty('--p', clamp(1 - view.sitRatio, 0, 1).toFixed(3));
    const dur = (m) => (window.FrogCore && FrogCore.fmtDur ? FrogCore.fmtDur(m) : `${Math.round(m) || 0} мин`);
    const soon = (m) => (m > 0 ? `через ${dur(m)}` : 'вот-вот');
    $bDrink.title = view.needs.water ? 'Пора пить! Нажми, когда попьёшь' : `Попил воды (следующий стакан ${soon(view.waterLeftMin)})`;
    $bMove.title = view.needs.move ? `Сидишь ${dur(view.sitMin)} — встань!` : `Размялся (разминка ${soon(view.moveLeftMin)})`;
    $bDrink.classList.toggle('alert', !!view.needs.water);
    $bMove.classList.toggle('alert', !!view.needs.move);
    $side.classList.toggle('hidden', !hover || dead);
  }
  $bDrink.addEventListener('click', () => bridge.action('drink'));
  $bMove.addEventListener('click', () => bridge.action('stretch'));
  if ($bTrophy) $bTrophy.addEventListener('click', () => bridge.action('openTrophies'));

  // ---------- мышь: прозрачные места пропускают клики ----------
  function isHit(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const r = $pet.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + x, r.top + y);
    if (el && el !== cv && el.closest('#bubble:not(.hidden), #side:not(.hidden), #toast.show')) return true;
    // жаба с ноутбуком и стакан целиком, чтобы не мигало между пикселями (без чтения пикселей);
    // пустое место над стаканом пропускает клики
    if (x > 56 && x < 208 && y > 80 + OY && y < FLOOR + OY + 4) return true;
    if (x >= 196 && x < 240 && y > 206 + OY && y < FLOOR + OY + 4) return true;
    // вне зоны — по маске прозрачности (уменьшенная копия холста, обновляется не чаще 5 раз в секунду)
    return hitAlpha(x, y) > 16;
  }
  const MS = 4, mask = document.createElement('canvas');
  mask.width = Math.ceil(W / MS); mask.height = Math.ceil(H / MS);
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  let maskData = null, maskAt = 0;
  function hitAlpha(x, y) {
    const now = performance.now();
    if (!maskData || now - maskAt > 200) {
      mctx.clearRect(0, 0, mask.width, mask.height);
      mctx.drawImage(cv, 0, 0, mask.width, mask.height);
      maskData = mctx.getImageData(0, 0, mask.width, mask.height).data;
      maskAt = now;
    }
    return maskData[(Math.floor(y / MS) * mask.width + Math.floor(x / MS)) * 4 + 3];
  }

  function setHover(h) {
    if (h) { if (!hover) kick(); hover = true; hoverOff = 0; }
    else if (hover && !hoverOff) hoverOff = performance.now();
    if (!h && hover && performance.now() - hoverOff > 1200) { hover = false; hoverOff = 0; }
    const ignore = !h && !drag;
    if (ignore !== ignoring) { ignoring = ignore; bridge.setIgnore(ignore); }
  }

  function trackPointer(x, y) {
    cursor.x = x; cursor.y = y; cursor.t = performance.now();
    // курсор вне окна — не трогаем DOM (elementFromPoint) на каждое сообщение
    const inWin = x >= 0 && y >= 0 && x < W && y < H;
    setHover(inWin && (isHit(x, y) || (hover && x < 70 && y > 170 && y < 312)));
  }

  const local = (e) => { const r = $pet.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    kick();
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    trackPointer(...local(e));
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
      drag.moved = true;
      cv.classList.add('dragging');
      bridge.dragStart(e);
    } else if (drag && drag.moved && bridge.dragMove) bridge.dragMove(e);
  });
  cv.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    cv.classList.remove('dragging');
    if (d.moved) bridge.dragEnd();
    else if (Death && Death.mode === 'dead') { Death.poke(); kick(); if (!bubbleKind) showRip(); }
    else if (alive()) bridge.action('poke');
    trackPointer(...local(e));
  });
  cv.addEventListener('pointercancel', () => {
    if (drag && drag.moved) bridge.dragEnd();
    drag = null;
    cv.classList.remove('dragging');
  });
  document.addEventListener('mousemove', (e) => trackPointer(...local(e)));
  document.addEventListener('mouseleave', () => setHover(false));
  // курсор приходит из main даже когда окно пропускает мышь насквозь
  bridge.onCursor((p) => { if (!drag) trackPointer(p.x, p.y); });

  // ---------- старт ----------
  const setView = (v) => {
    const was = view.activity;
    view = Object.assign({ needs: {}, day: {} }, v || {}, debugPatch || {});
    if (view.activity !== was) kick();
    if (awaitView) { awaitView = 0; syncNow = true; }
  };
  const setSettings = (s) => {
    settings = s || settings;
    const snd = settings.sound !== false;
    if (window.FrogToast && FrogToast.setSound) FrogToast.setSound(snd);
    if (Death) Death.setSound(snd);
  };
  if (Death) Death.init({ W, H, OY, FLOOR, back, front, getDpr: () => dpr,
    onTomb: () => { showRip(); },   // death.js сам зовёт onTomb, когда надгробие встало
    onHatched: (info) => { croak(); say((info && info.text) || `Ква! Я Жабка #${view.generation || 1}. Наушники на месте 🎧`, { ttl: 5000 }); },
  });
  bridge.onView(setView);
  bridge.onEvent(onEvent);
  bridge.onSettings(setSettings);
  bridge.init().then((d) => {
    if (d) { setSettings(d.settings); setView(d.view || view); }
    syncNow = true;    // мёртвая на старте — сразу надгробие
    first = true;
    started = true;
    kick();
  });

  // отладочный хук (и для съёмки): __frogDebug.event({type:'death', cause:'stone'}), __frogDebug.view({critical:{water:true}})
  window.__frogDebug = {
    event: (ev) => onEvent(ev),
    view(patch) { debugPatch = patch ? Object.assign(debugPatch || {}, patch) : null; setView(view); },
    hit: (x, y) => isHit(x, y),
    state: () => ({ mode: Death ? Death.mode : 'none', life: view.life, sm: Object.assign({}, sm), particles: particles.length, frames, hidden: hiddenNow(), death: Death && Death.stats ? Death.stats() : null }),
  };
})();
