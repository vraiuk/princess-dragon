// Жаба-программист: всё рисуется кодом на canvas.
(function () {
  'use strict';
  const bridge = window.frog;
  const W = 260, H = 320, OY = 20;        // OY — отступ сверху под облачко
  const FLOOR = 268;                       // линия стола (в координатах раскладки)

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
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

  // ---------- состояние ----------
  let view = { glass: 1, dry: 0, stone: 0, activity: 'coding', needs: {}, day: {}, paused: false, waterLeftMin: 45, moveLeftMin: 50, sitMin: 0 };
  let settings = { sound: true };
  const sm = { dry: 0, stone: 0, glass: 1 };      // сглаженные значения для анимации
  const cursor = { x: 130, y: 400, t: 0 };
  const eye = { x: 0, y: 4 };
  const anim = {};
  let particles = [];
  let blink = { next: 2, t: -1 };
  let glanceUntil = 0, nextGlance = 4;
  let glyphTimer = 0, zTimer = 0, bubbleTimer = null, bubbleKind = null;
  let hover = false, hoverOff = 0, ignoring = true;
  let first = true;

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
    dpr = Math.max(1, window.devicePixelRatio || 1);
    for (const c of [cv, back, front]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  }
  resize();
  window.addEventListener('resize', resize);
  matchMedia(`(resolution: ${dpr}dppx)`).addEventListener?.('change', resize);

  // ---------- звук «ква» ----------
  let actx = null;
  function croak(vol = 0.18) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
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
  function say(text, opts = {}) {
    clearTimeout(bubbleTimer);
    $bubble.querySelector('.txt').textContent = text;
    $bubble.querySelector('.tip').textContent = opts.tip || '';
    const btns = $bubble.querySelector('.btns');
    btns.innerHTML = '';
    (opts.buttons || []).forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.main) el.className = 'main';
      el.addEventListener('click', (e) => { e.stopPropagation(); hideBubble(); b.do(); });
      btns.appendChild(el);
    });
    $bubble.className = opts.kind || '';
    bubbleKind = opts.kind || null;
    bubbleTimer = setTimeout(hideBubble, opts.ttl || 6000);
  }
  function hideBubble() {
    clearTimeout(bubbleTimer);
    $bubble.classList.add('hidden');
    bubbleKind = null;
  }

  // ---------- события из main ----------
  function onEvent(ev) {
    const now = performance.now() / 1000;
    switch (ev.type) {
      case 'remind':
        anim.alert = { t0: now, dur: 1.4 };
        croak();
        if (ev.kind === 'water') {
          say(ev.text, { kind: 'water', ttl: 90000, buttons: [
            { label: 'Попил 💧', main: true, do: () => bridge.action('drink') },
            { label: 'Позже', do: () => bridge.action('snooze', { kind: 'water' }) },
          ] });
        } else {
          say(ev.text, { kind: 'move', tip: ev.tip, ttl: 90000, buttons: [
            { label: 'Размялся 🤸', main: true, do: () => bridge.action('stretch') },
            { label: 'Позже', do: () => bridge.action('snooze', { kind: 'move' }) },
          ] });
        }
        break;
      case 'drink':
        anim.drink = { t0: now, dur: 1.9 };
        say(ev.text, { ttl: 4000 });
        break;
      case 'stretch':
      case 'back':
        startJump(now);
        say(ev.text, { ttl: 5000 });
        break;
      case 'poke':
        anim.squish = { t0: now, dur: 0.55 };
        croak(0.08);
        say(ev.text, { ttl: 4500 });
        break;
      case 'morning':
        anim.alert = { t0: now, dur: 1.4 };
        croak();
        say(ev.text, { kind: 'water', ttl: 120000, buttons: [
          { label: 'Попил 💧', main: true, do: () => bridge.action('drink') },
          { label: 'Позже', do: () => bridge.action('snooze', { kind: 'water' }) },
        ] });
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
    let dy = 0, sx = 1, sy = 1 + 0.012 * Math.sin(t * (view.activity === 'away' ? 1.3 : 2.2)) * (1 - sm.stone);
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
    g.translate(130, FLOOR + OY + dy);
    g.rotate(rot);
    g.scale(sx, sy);
    g.translate(-130, -FLOOR);
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

    // наушники: дуга за глазами
    g.strokeStyle = '#1f2330'; g.lineWidth = 9;
    g.beginPath(); g.arc(130, 152, 76, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
    g.strokeStyle = '#4a5268'; g.lineWidth = 3;
    g.beginPath(); g.arc(130, 152, 76, Math.PI * 1.12, Math.PI * 1.88); g.stroke();

    // глаза
    const sleeping = view.activity === 'away';
    let lid = 0.08 + sm.dry * 0.38;
    if (blink.t >= 0) lid = Math.max(lid, 1 - Math.abs(blink.t - 0.07) / 0.07);
    if (sleeping) lid = 1;
    if (sm.stone > 0.93) lid = Math.max(lid, 0.3);
    for (const ex of [100, 160]) drawEye(g, ex, 114, lid, C, sleeping);

    // наушники: чашки поверх
    const led = view.paused ? '#ff5d5d' : view.activity === 'coding' ? '#6ee7b7' : '#8aa0ff';
    for (const [x, dir] of [[62, -1], [198, 1]]) {
      g.fillStyle = '#1f2330';
      rr(g, x - 9, 132, 18, 38, 8); g.fill();
      g.fillStyle = '#343b50';
      rr(g, x - 5 - dir * 2, 136, 10, 30, 5); g.fill();
      g.fillStyle = led;
      g.beginPath(); g.arc(x + dir * 4, 141, 2.2, 0, Math.PI * 2); g.fill();
    }

    // ноздри
    g.fillStyle = C.line;
    ell(g, 123, 138, 2.2, 1.5); g.fill();
    ell(g, 137, 138, 2.2, 1.5); g.fill();

    // щёчки
    g.fillStyle = `rgba(255,120,140,${0.35 * (1 - sm.dry) * (1 - sm.stone)})`;
    ell(g, 86, 160, 11, 6); g.fill();
    ell(g, 174, 160, 11, 6); g.fill();

    drawMouth(g, t, C);

    // блеск влажной кожи
    g.fillStyle = `rgba(255,255,255,${0.38 * (1 - sm.dry)})`;
    ell(g, 102, 132, 13, 4.5, -0.25); g.fill();
    ell(g, 88, 100, 6, 3, -0.7); g.fill();
    ell(g, 148, 98, 6, 3, -0.7); g.fill();

    drawWrinkles(g, C);

    // свечение экрана на мордочке
    if (view.activity === 'coding' || view.activity === 'thinking') {
      g.globalCompositeOperation = 'source-atop';
      const gr = g.createLinearGradient(0, 200, 0, 120);
      gr.addColorStop(0, 'rgba(120,200,255,0.38)');
      gr.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 100, W, 140);
      g.globalCompositeOperation = 'source-over';
    }

    applyStone(g, t);
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
    const happy = anim.drink || anim.jump || anim.squish;
    if (view.activity === 'away') {
      g.fillStyle = C.line;
      ell(g, 130, 163, 4, 3 + Math.sin(t * 1.3)); g.fill();
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
      const len = 8 + 16 * k + Math.sin(t * 3) * 1.5;
      g.beginPath();
      g.moveTo(123, 165); g.lineTo(123, 165 + len);
      g.arc(130, 165 + len, 7, Math.PI, 0, true);
      g.lineTo(137, 165); g.closePath(); g.fill();
      g.strokeStyle = '#b84a62'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(130, 168); g.lineTo(130, 162 + len); g.stroke();
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
    gr.addColorStop(0, '#a9aaa3'); gr.addColorStop(1, '#7d7e78');
    g.globalAlpha = 0.86;
    g.fillStyle = gr;
    g.fillRect(-10, y0 - 10, W + 20, H);
    g.globalAlpha = 1;
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

  function drawFront(g, t, C) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    frogTransform(g, t);
    const typing = view.activity === 'coding' && sm.stone < 0.85 && !anim.jump;
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
    g.restore();
  }

  function drawLaptop(g, t) {
    g.save();
    g.translate(0, OY);
    // свечение экрана из-за крышки
    if (view.activity !== 'away') {
      const gr = g.createRadialGradient(130, 196, 4, 130, 196, 70);
      gr.addColorStop(0, 'rgba(140,215,255,0.45)');
      gr.addColorStop(1, 'rgba(140,215,255,0)');
      g.fillStyle = gr;
      ell(g, 130, 196, 70, 16); g.fill();
    }
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
    // жар над пересохшей жабой
    if (sm.dry > 0.5) {
      g.save();
      g.strokeStyle = `rgba(255,170,60,${(sm.dry - 0.5) * 0.9})`;
      g.lineWidth = 2; g.lineCap = 'round';
      for (const x of [104, 130, 156]) {
        g.beginPath();
        for (let k = 0; k <= 12; k++) {
          const y = 90 + OY - k * 2.2 - ((t * 12) % 8);
          g.lineTo(x + Math.sin(k * 0.9 + t * 4 + x) * 3, y);
        }
        g.stroke();
      }
      g.restore();
    }

    // значок нужды над головой
    if (!bubbleKind && (view.needs.water || view.needs.move) && view.activity !== 'away') {
      const icon = view.needs.water && view.needs.move ? '💧🗿' : view.needs.water ? '💧' : '🗿';
      g.save();
      g.globalAlpha = 0.85 + 0.15 * Math.sin(t * 4);
      g.font = `${20 + 2 * Math.sin(t * 4)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(icon, 130, 64 + OY + Math.sin(t * 2.5) * 3);
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
  let lastT = performance.now() / 1000, acc = 0;
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, t - lastT);
    // ~30 fps; во сне — ещё реже, чтобы не жечь батарею
    const step = view.activity === 'away' && !Object.keys(anim).length ? 1 / 12 : 1 / 30;
    acc += dt; lastT = t;
    if (acc < step) return;
    const fdt = acc; acc = 0;
    update(t, fdt);
    render(t, fdt);
  }

  function update(t, dt) {
    for (const k of Object.keys(anim)) if (t - anim[k].t0 > anim[k].dur) delete anim[k];

    const fast = anim.jump || anim.drink;
    const rate = first ? 1 : 1 - Math.exp(-dt * (fast ? 2.2 : 0.9));
    first = false;
    sm.dry = lerp(sm.dry, view.dry, anim.drink ? rate * 0.6 : rate);
    sm.stone = lerp(sm.stone, view.stone, rate);
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
    else if (cursorFresh) { tx = cursor.x; ty = cursor.y; }
    else { tx = 130 + Math.sin(t * 0.4) * 120; ty = 140 + OY; }
    const dx = tx - 130, dy = ty - (114 + OY), d = Math.hypot(dx, dy) || 1;
    const m = Math.min(6, d * 0.04);
    const frozen = sm.stone > 0.93;
    if (!frozen) {
      eye.x = lerp(eye.x, (dx / d) * m, 1 - Math.exp(-dt * 10));
      eye.y = lerp(eye.y, (dy / d) * m, 1 - Math.exp(-dt * 10));
    }

    // частицы-эмиттеры
    if (view.activity === 'coding' && sm.stone < 0.85 && !anim.jump) {
      if ((glyphTimer -= dt) <= 0) {
        glyphTimer = rnd(0.5, 1.1);
        const glyphs = ['{ }', '</>', ';', '=>', '()', '[]', '&&', '!=', 'fn', '01', '++', '#', '$', '//', '?.'];
        const cols = ['#6ee7b7', '#7cc4ff', '#ffd25a', '#ff9ac4', '#c4a7ff'];
        particles.push({ kind: 'glyph', x: Math.random() < 0.5 ? rnd(66, 86) : rnd(174, 194), y: 200 + OY, text: glyphs[Math.floor(Math.random() * glyphs.length)], color: cols[Math.floor(Math.random() * cols.length)], size: rnd(9, 12), life: 0, max: rnd(1.6, 2.4), ph: rnd(0, 6) });
      }
    }
    if (view.activity === 'away' && (zTimer -= dt) <= 0) {
      zTimer = 1.3;
      particles.push({ kind: 'z', x: 168, y: 96 + OY, size: rnd(12, 18), life: 0, max: 2.6 });
    }
    if (anim.drink) {
      const p = (t - anim.drink.t0) / anim.drink.dur;
      if (p < 0.55) {
        for (let i = 0; i < 2; i++) {
          // струйка из стакана в рот по параболе
          const sx = 214 + rnd(-3, 3), sy = 212 + OY, tx2 = 130 + rnd(-6, 6), ty2 = 164 + OY, T = 32;
          particles.push({ kind: 'drop', x: sx, y: sy, vx: (tx2 - sx) / T, vy: (ty2 - sy) / T - 0.5 * 9.8 * 0.12 * T, size: rnd(2, 3.4), life: 0, max: 0.55 });
        }
      } else if (Math.random() < 0.5) {
        particles.push({ kind: 'spark', x: rnd(70, 190), y: rnd(90, 200) + OY, size: rnd(4, 8), color: Math.random() < 0.5 ? '#bfe6ff' : '#ffffff', life: 0, max: rnd(0.4, 0.8) });
      }
    }
  }

  function render(t, dt) {
    const C = colors();
    drawBack(bctx, t, C);
    drawFront(fctx, t, C);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // тень на столе
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ell(ctx, 136, FLOOR + OY + 2, 106, 9); ctx.fill();
    ctx.drawImage(back, 0, 0, W, H);
    drawLaptop(ctx, t);
    ctx.drawImage(front, 0, 0, W, H);
    drawGlass(ctx, t);
    drawEffects(ctx, t, dt);
    updateSide();
  }

  // ---------- кнопки сбоку ----------
  let sideStamp = '';
  function updateSide() {
    const stamp = [view.waterLeftMin, view.moveLeftMin, view.needs.water, view.needs.move, hover].join();
    if (stamp === sideStamp) return;
    sideStamp = stamp;
    $bDrink.style.setProperty('--p', clamp(view.glass, 0, 1).toFixed(3));
    $bMove.style.setProperty('--p', clamp(1 - view.sitRatio, 0, 1).toFixed(3));
    $bDrink.title = view.needs.water ? 'Пора пить! Нажми, когда попьёшь' : `Попил воды (следующий стакан через ${view.waterLeftMin} мин)`;
    $bMove.title = view.needs.move ? `Сидишь ${view.sitMin} мин — встань!` : `Размялся (разминка через ${view.moveLeftMin} мин)`;
    $bDrink.classList.toggle('alert', !!view.needs.water);
    $bMove.classList.toggle('alert', !!view.needs.move);
    $side.classList.toggle('hidden', !hover);
  }
  $bDrink.addEventListener('click', () => bridge.action('drink'));
  $bMove.addEventListener('click', () => bridge.action('stretch'));

  // ---------- мышь: прозрачные места пропускают клики ----------
  function isHit(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const r = $pet.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + x, r.top + y);
    if (el && el !== cv && el.closest('#bubble:not(.hidden), #side:not(.hidden)')) return true;
    const px = ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data;
    if (px[3] > 24) return true;
    // вся зона жабы целиком, чтобы не мигало между пикселями
    return x > 56 && x < 240 && y > 80 + OY && y < FLOOR + OY + 4;
  }

  function setHover(h) {
    if (h) { hover = true; hoverOff = 0; }
    else if (hover && !hoverOff) hoverOff = performance.now();
    if (!h && hover && performance.now() - hoverOff > 1200) { hover = false; hoverOff = 0; }
    const ignore = !h && !drag;
    if (ignore !== ignoring) { ignoring = ignore; bridge.setIgnore(ignore); }
  }

  function trackPointer(x, y) {
    cursor.x = x; cursor.y = y; cursor.t = performance.now();
    setHover(isHit(x, y) || (hover && x > 0 && x < 70 && y > 190 && y < 310));
  }

  const local = (e) => { const r = $pet.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
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
    else bridge.action('poke');
    trackPointer(...local(e));
  });
  document.addEventListener('mousemove', (e) => trackPointer(...local(e)));
  document.addEventListener('mouseleave', () => setHover(false));
  // курсор приходит из main даже когда окно пропускает мышь насквозь
  bridge.onCursor((p) => { if (!drag) trackPointer(p.x, p.y); });

  // ---------- старт ----------
  bridge.onView((v) => { view = v; });
  bridge.onEvent(onEvent);
  bridge.onSettings((s) => { settings = s; });
  bridge.init().then((d) => {
    if (d) { settings = d.settings || settings; view = d.view || view; }
    first = true;
    requestAnimationFrame(frame);
  });
})();
