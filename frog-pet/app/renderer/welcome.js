// Окно «Добро пожаловать»: 4 экрана онбординга с живой мини-жабой на canvas.
(function () {
  'use strict';

  const DEFAULTS = { waterEvery: 45, moveEvery: 50, breakAfter: 5, nagEvery: 10, sound: true, notify: true, scale: 1, launchAtLogin: true, deathEnabled: true };

  // мок для браузера: страница открывается и без Electron
  function mockApp() {
    const settings = Object.assign({}, DEFAULTS);
    return {
      getData: () => Promise.resolve({ settings: Object.assign({}, settings), view: {}, state: {}, achievements: [], graveyard: [], version: 'dev' }),
      onUpdate() {},
      setSetting(k, v) { settings[k] = v; },
      action() {},
      open(name) { location.href = name + '.html'; },
      finishOnboarding() { document.body.style.opacity = '0.4'; },
      close() { window.close(); },
    };
  }
  const app = window.frogApp || mockApp();

  const Core = window.FrogCore || {};
  const DEATH_WATER = Core.DEATH_WATER || 3.0;
  const DEATH_STONE = Core.DEATH_STONE || 2.4;

  let S = Object.assign({}, DEFAULTS);
  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const mix = (c1, c2, t) => `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function fmt(min) {
    min = Math.round(min);
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' мин';
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }

  // ================= мини-жаба (упрощённая версия pet.js) =================
  const FLOOR = 268;
  const PAL = {
    skin: [[92, 201, 107], [190, 163, 96]],
    dark: [[42, 138, 66], [128, 104, 58]],
    belly: [[205, 240, 160], [232, 216, 170]],
    line: [[24, 64, 36], [84, 62, 30]],
  };
  // детерминированные пятна камня
  let seed = 11;
  const srnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const SPECKS = [];
  for (let i = 0; i < 140; i++) SPECKS.push({ x: 60 + srnd() * 140, y: 80 + srnd() * 200, r: 0.7 + srnd() * 2, s: srnd() });
  const CRACKS = [];
  for (let i = 0; i < 7; i++) {
    let x = 75 + srnd() * 110, y = 120 + srnd() * 130;
    const pts = [[x, y]];
    for (let k = 0; k < 4; k++) { x += (srnd() - 0.5) * 22; y += 4 + srnd() * 12; pts.push([x, y]); }
    CRACKS.push(pts);
  }

  function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

  function colors(d) {
    return { skin: mix(PAL.skin[0], PAL.skin[1], d), dark: mix(PAL.dark[0], PAL.dark[1], d), belly: mix(PAL.belly[0], PAL.belly[1], d), line: mix(PAL.line[0], PAL.line[1], d) };
  }

  // f: { t, dry, stone, lid, eye:{x,y}, mouth, away, typing, dy, sx, sy, rot }
  function frogTransform(g, f) {
    g.translate(130, FLOOR + (f.dy || 0));
    g.rotate(f.rot || 0);
    g.scale(f.sx || 1, (f.sy || 1) * (1 + 0.012 * Math.sin(f.t * (f.away ? 1.3 : 2.2)) * (1 - f.stone)));
    g.translate(-130, -FLOOR);
  }

  function drawBody(g, f, C) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    // худи
    g.fillStyle = '#2c355c'; ell(g, 130, 192, 50, 24); g.fill();
    g.strokeStyle = '#151a30'; g.lineWidth = 3; ell(g, 130, 232, 64, 44); g.stroke();
    g.fillStyle = '#3d4a7a'; ell(g, 130, 232, 64, 44); g.fill();
    g.strokeStyle = '#e8ecff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(120, 194); g.lineTo(118, 214); g.moveTo(140, 194); g.lineTo(142, 214); g.stroke();
    // голова
    const shapes = (fn) => {
      ell(g, 130, 150, 64, 46); fn();
      g.beginPath(); g.arc(100, 114, 24, 0, Math.PI * 2); fn();
      g.beginPath(); g.arc(160, 114, 24, 0, Math.PI * 2); fn();
    };
    g.strokeStyle = C.line; g.lineWidth = 5; shapes(() => g.stroke());
    g.fillStyle = C.skin; shapes(() => g.fill());
    g.save();
    ell(g, 130, 150, 64, 46); g.clip();
    g.fillStyle = C.dark; g.globalAlpha = 0.35; ell(g, 130, 196, 80, 30); g.fill();
    g.globalAlpha = 1; g.fillStyle = C.belly; ell(g, 130, 186, 44, 20); g.fill();
    g.restore();
    g.fillStyle = C.dark; g.globalAlpha = 0.45;
    ell(g, 82, 134, 6, 4, -0.4); g.fill(); ell(g, 176, 132, 7, 4.5, 0.4); g.fill();
    g.globalAlpha = 1;
    // наушники
    g.strokeStyle = '#1f2330'; g.lineWidth = 9;
    g.beginPath(); g.arc(130, 152, 76, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
    g.strokeStyle = '#4a5268'; g.lineWidth = 3;
    g.beginPath(); g.arc(130, 152, 76, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
    // глаза
    for (const ex of [100, 160]) drawEye(g, ex, 114, f, C);
    const led = f.away ? '#8aa0ff' : '#6ee7b7';
    for (const [x, dir] of [[62, -1], [198, 1]]) {
      g.fillStyle = '#1f2330'; rr(g, x - 9, 132, 18, 38, 8); g.fill();
      g.fillStyle = '#343b50'; rr(g, x - 5 - dir * 2, 136, 10, 30, 5); g.fill();
      g.fillStyle = led; g.beginPath(); g.arc(x + dir * 4, 141, 2.2, 0, Math.PI * 2); g.fill();
    }
    // ноздри, щёчки
    g.fillStyle = C.line;
    ell(g, 123, 138, 2.2, 1.5); g.fill(); ell(g, 137, 138, 2.2, 1.5); g.fill();
    g.fillStyle = `rgba(255,120,140,${0.4 * (1 - f.dry) * (1 - f.stone)})`;
    ell(g, 86, 160, 11, 6); g.fill(); ell(g, 174, 160, 11, 6); g.fill();
    drawMouth(g, f, C);
    // блеск
    g.fillStyle = `rgba(255,255,255,${0.38 * (1 - f.dry)})`;
    ell(g, 102, 132, 13, 4.5, -0.25); g.fill();
    ell(g, 88, 100, 6, 3, -0.7); g.fill(); ell(g, 148, 98, 6, 3, -0.7); g.fill();
    // морщины
    const a = clamp((f.dry - 0.15) * 1.4, 0, 1);
    if (a > 0) {
      g.strokeStyle = C.line; g.globalAlpha = a * 0.7; g.lineWidth = 1.5;
      for (const [x, y, r, s, e] of [[130, 124, 9, 1.15, 1.85], [130, 131, 12, 1.2, 1.8], [100, 132, 12, 0.2, 0.8], [160, 132, 12, 0.2, 0.8], [84, 170, 9, 1.4, 1.95], [176, 170, 9, 1.05, 1.6]]) {
        g.beginPath(); g.arc(x, y, r, Math.PI * s, Math.PI * e); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  function drawEye(g, ex, ey, f, C) {
    g.fillStyle = '#fffef6'; g.beginPath(); g.arc(ex, ey, 17, 0, Math.PI * 2); g.fill();
    const wide = f.wide ? 1.12 : 1;
    if (!f.away) {
      const px = ex + f.eye.x, py = ey + f.eye.y;
      g.fillStyle = '#18201a'; g.beginPath(); g.arc(px, py, 8.5 / wide, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(px - 3, py - 3.2, 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px + 3, py + 3, 1.2, 0, Math.PI * 2); g.fill();
    }
    const lid = f.away ? 1 : f.lid;
    if (lid > 0.01) {
      g.save();
      g.beginPath(); g.arc(ex, ey, 17.5, 0, Math.PI * 2); g.clip();
      const yb = ey - 17 + 34 * lid, bend = 5 * (lid < 0.95 ? 1 : 0.2);
      g.fillStyle = C.skin;
      g.beginPath(); g.moveTo(ex - 20, ey - 20); g.lineTo(ex + 20, ey - 20); g.lineTo(ex + 20, yb);
      g.quadraticCurveTo(ex, yb + bend, ex - 20, yb); g.fill();
      g.strokeStyle = C.line; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(ex - 20, yb); g.quadraticCurveTo(ex, yb + bend, ex + 20, yb); g.stroke();
      g.restore();
    }
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, 17, 0, Math.PI * 2); g.stroke();
  }

  function drawMouth(g, f, C) {
    g.strokeStyle = C.line; g.lineWidth = 3; g.lineCap = 'round';
    const m = f.mouth;
    if (f.away) {
      g.fillStyle = C.line; ell(g, 130, 163, 4, 3 + Math.sin(f.t * 1.3)); g.fill();
    } else if (m === 'happy') {
      g.fillStyle = '#5a1f2a';
      g.beginPath(); g.moveTo(104, 158); g.quadraticCurveTo(130, 192, 156, 158); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff7f96'; ell(g, 130, 172, 9, 5); g.fill();
    } else if (m === 'flat') {
      g.beginPath(); g.moveTo(108, 163); g.lineTo(152, 163); g.stroke();
    } else if (m === 'wavy') {
      g.beginPath(); g.moveTo(108, 164);
      for (let x = 108; x <= 152; x += 4) g.lineTo(x, 164 + Math.sin(x * 0.7 + f.t * 8) * 2);
      g.stroke();
    } else if (f.dry > 0.45) {
      const k = clamp((f.dry - 0.45) / 0.55, 0, 1);
      g.fillStyle = '#4a1d22'; ell(g, 130, 164, 13, 5 + 3 * k); g.fill(); g.stroke();
      g.fillStyle = '#e8728a';
      const len = 8 + 16 * k + Math.sin(f.t * 3) * 1.5;
      g.beginPath(); g.moveTo(123, 165); g.lineTo(123, 165 + len);
      g.arc(130, 165 + len, 7, Math.PI, 0, true); g.lineTo(137, 165); g.closePath(); g.fill();
    } else if (m === 'code') {
      g.beginPath(); g.moveTo(108, 160); g.quadraticCurveTo(130, 172, 152, 160); g.stroke();
      g.fillStyle = '#ff8fa3'; ell(g, 148, 164, 3.5, 2.5, 0.4); g.fill();
    } else {
      g.beginPath(); g.moveTo(100, 158); g.quadraticCurveTo(130, 178, 160, 158); g.stroke();
    }
  }

  function drawPaws(g, f, C) {
    const typing = f.typing && !f.away && f.stone < 0.85;
    const tap = (ph) => (typing ? -3.5 * Math.max(0, Math.sin(f.t * 17 + ph)) : 0);
    const up = f.armsUp ? -14 : 0;
    for (const [x, ph, dir] of [[90, 0, -1], [170, Math.PI * 0.9, 1]]) {
      const y = 196 + tap(ph) + up;
      g.fillStyle = '#3d4a7a'; g.strokeStyle = '#151a30'; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x + dir * 22, 214); g.quadraticCurveTo(x + dir * 18, y + 2, x + dir * 6, y + 4);
      g.lineTo(x - dir * 6, y + 6); g.quadraticCurveTo(x + dir * 4, 222, x + dir * 22, 226);
      g.fill(); g.stroke();
      g.fillStyle = C.skin; g.strokeStyle = C.line; g.lineWidth = 2.2;
      for (const fx of [-8, 0, 8]) { g.beginPath(); g.arc(x + fx, y + 1 - (fx === 0 ? 1.5 : 0), 5, 0, Math.PI * 2); g.stroke(); }
      ell(g, x, y + 5, 13, 7.5); g.stroke(); ell(g, x, y + 5, 13, 7.5); g.fill();
      for (const fx of [-8, 0, 8]) { g.beginPath(); g.arc(x + fx, y + 1 - (fx === 0 ? 1.5 : 0), 5, 0, Math.PI * 2); g.fill(); }
    }
  }

  function applyStone(g, s, t) {
    if (s < 0.004) return;
    const y0 = FLOOR - s * (FLOOR - 82);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.beginPath(); g.moveTo(-10, 400);
    for (let x = -10; x <= 270; x += 6) g.lineTo(x, y0 + 4 * Math.sin(x * 0.13 + 1.7) + 2.5 * Math.sin(x * 0.37));
    g.lineTo(270, 400); g.closePath(); g.clip();
    const gr = g.createLinearGradient(0, y0, 0, FLOOR);
    gr.addColorStop(0, '#a9aaa3'); gr.addColorStop(1, '#7d7e78');
    g.globalAlpha = 0.88; g.fillStyle = gr; g.fillRect(-10, y0 - 10, 280, 400);
    g.globalAlpha = 1;
    for (const p of SPECKS) {
      g.fillStyle = p.s > 0.5 ? 'rgba(60,60,58,.45)' : 'rgba(235,235,228,.45)';
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(50,50,48,.7)'; g.lineWidth = 1.3;
    for (const pts of CRACKS) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
    }
    g.restore();
  }

  function drawLaptop(g, glow) {
    if (glow) {
      const gr = g.createRadialGradient(130, 196, 4, 130, 196, 70);
      gr.addColorStop(0, 'rgba(140,215,255,0.45)'); gr.addColorStop(1, 'rgba(140,215,255,0)');
      g.fillStyle = gr; ell(g, 130, 196, 70, 16); g.fill();
    }
    g.beginPath();
    g.moveTo(84, 194); g.lineTo(176, 194); g.quadraticCurveTo(182, 194, 183, 200);
    g.lineTo(186, 254); g.quadraticCurveTo(186, 260, 180, 260);
    g.lineTo(80, 260); g.quadraticCurveTo(74, 260, 74, 254);
    g.lineTo(77, 200); g.quadraticCurveTo(78, 194, 84, 194); g.closePath();
    const gr = g.createLinearGradient(0, 194, 0, 260);
    gr.addColorStop(0, '#e4e8ee'); gr.addColorStop(1, '#aeb5c1');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#4b5263'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#1f2433'; rr(g, 106, 214, 48, 24, 7); g.fill();
    g.fillStyle = '#6ee7b7'; g.font = 'bold 14px Menlo, Monaco, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('</>', 130, 226.5);
    g.fillStyle = '#ffd25a'; g.beginPath(); g.arc(94, 246, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a5a00'; g.font = 'bold 8px sans-serif'; g.fillText('JS', 94, 246.5);
    g.fillStyle = '#8e95a2'; rr(g, 62, 259, 136, 8, 4); g.fill();
    g.strokeStyle = '#4b5263'; g.lineWidth = 1.5; g.stroke();
  }

  function drawGlass(g, lvl, t) {
    const x0 = 206, x1 = 240, y0 = 214, y1 = 266, bx0 = 209, bx1 = 237;
    const path = () => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(bx1, y1); g.quadraticCurveTo(223, y1 + 3, bx0, y1); g.closePath(); };
    path(); g.fillStyle = 'rgba(225,240,255,0.25)'; g.fill();
    g.save(); path(); g.clip();
    if (lvl > 0.01) {
      const top = y1 - 2 - lvl * (y1 - y0 - 6);
      g.beginPath(); g.moveTo(x0 - 2, 300);
      for (let x = x0 - 2; x <= x1 + 2; x += 2) g.lineTo(x, top + Math.sin(x * 0.4 + t * 3) * 1.2);
      g.lineTo(x1 + 2, 300); g.closePath();
      const wg = g.createLinearGradient(0, top, 0, y1);
      wg.addColorStop(0, 'rgba(110,190,255,0.85)'); wg.addColorStop(1, 'rgba(40,120,220,0.9)');
      g.fillStyle = wg; g.fill();
    }
    g.restore();
    path(); g.strokeStyle = 'rgba(70,110,150,0.85)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0 + 5, y0 + 6); g.lineTo(bx0 + 4, y1 - 8); g.stroke();
  }

  // ================= сцены =================
  // каждая сцена: canvas, offscreen для тела (камень кладётся source-atop только на жабу)
  const scenes = [];
  const mouse = { x: -1, y: -1, t: 0 };
  document.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now() / 1000; });

  function makeScene(cv) {
    const sc = {
      cv, kind: cv.dataset.scene, g: cv.getContext('2d'), off: document.createElement('canvas'),
      blink: { next: 1.5, t: -1 }, eye: { x: 0, y: 4 }, parts: [], t0: 0, poke: -9, pill: document.querySelector(`[data-pill="${cv.dataset.scene}"]`),
      lastPill: '', jumped: false,
    };
    sc.og = sc.off.getContext('2d');
    cv.addEventListener('click', () => { sc.poke = performance.now() / 1000; });
    return sc;
  }

  function sizeScene(sc) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = sc.cv.clientWidth, h = sc.cv.clientHeight;
    if (!w || !h) return false;
    if (sc.cv.width !== Math.round(w * dpr) || sc.cv.height !== Math.round(h * dpr)) {
      sc.cv.width = sc.off.width = Math.round(w * dpr);
      sc.cv.height = sc.off.height = Math.round(h * dpr);
    }
    sc.dpr = dpr; sc.w = w; sc.h = h;
    // жаба: в координатах pet.js голова от y≈88 до пола 268
    // от верха дуги наушников (y≈72) до пола (268) + поля
    const room = h - (sc.pill ? 26 : 4);
    sc.k = room / (FLOOR - 64 + 8);
    sc.ox = w / 2 - 130 * sc.k - (sc.kind === 'water' ? 18 * sc.k : 0);
    sc.oy = room - 8 * sc.k - FLOOR * sc.k;
    return true;
  }

  function setPill(sc, text) {
    if (!sc.pill || sc.lastPill === text) return;
    sc.lastPill = text;
    sc.pill.textContent = text;
  }

  function burst(sc, n, kind) {
    for (let i = 0; i < n; i++) {
      const x = rnd(80, 180), y = rnd(150, 250);
      sc.parts.push({ kind, x, y, vx: (x - 130) * rnd(0.02, 0.05) + rnd(-1, 1), vy: rnd(-5, -2), life: 0, max: rnd(1, 1.8), size: rnd(2.5, 6), rot: rnd(0, 6), vr: rnd(-6, 6), shade: rnd(0, 1) });
    }
  }

  const GLYPHS = ['{ }', '</>', '=>', ';', '()', '[]', '&&', '++'];
  function tickParts(sc, g, dt) {
    sc.parts = sc.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of sc.parts) {
      const a = 1 - p.life / p.max;
      g.save(); g.globalAlpha = a;
      if (p.kind === 'chunk') {
        p.vy += 22 * dt; p.x += p.vx * dt * 30; p.y += p.vy * dt * 30; p.rot += p.vr * dt;
        g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.shade > 0.5 ? '#9c9d96' : '#7d7e78';
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
      } else {
        p.y -= 26 * dt; p.x += Math.sin(p.life * 3 + p.shade * 6) * 0.3;
        g.font = p.kind === 'glyph' ? 'bold 15px Menlo, monospace' : '18px -apple-system, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = p.kind === 'glyph' ? (p.shade > 0.5 ? '#3fae5a' : '#2f8de4') : p.kind === 'z' ? '#8aa0ff' : '#e05a8a';
        if (p.kind === 'z') g.font = `bold ${12 + p.life * 8}px -apple-system, sans-serif`;
        g.fillText(p.text, p.x, p.y);
      }
      g.restore();
    }
  }

  function bubble(g, text) {
    g.save();
    g.font = 'bold 16px -apple-system, sans-serif';
    const w = g.measureText(text).width + 22;
    const x = 205, y = 70;
    g.fillStyle = '#fff'; g.strokeStyle = '#1d3b26'; g.lineWidth = 2;
    rr(g, x - w / 2, y - 16, w, 32, 14); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - 18, y + 14); g.lineTo(x - 26, y + 26); g.lineTo(x - 6, y + 15); g.closePath(); g.fill();
    g.fillStyle = '#1f2a22'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
    g.restore();
  }

  // состояние жабы для каждого кадра сцены
  function sceneState(sc, now, lt) {
    const f = { t: now, dry: 0, stone: 0, lid: 0.08, eye: sc.eye, mouth: 'code', away: false, typing: true, glow: true, dy: 0, sx: 1, sy: 1, rot: 0, glass: -1 };
    const jumpAt = (t0, dur = 1.6) => {
      const p = (lt - t0) / dur;
      if (p < 0 || p > 1) return;
      const ph = (p * 2) % 1;
      f.dy = -38 * Math.sin(Math.PI * ph) * (1 - p * 0.35);
      const land = ph < 0.12 ? 1 - ph / 0.12 : 0;
      f.sy *= 1 - 0.1 * land; f.sx *= 1 + 0.08 * land;
      f.mouth = 'happy'; f.armsUp = true; f.typing = false;
    };

    if (sc.kind === 'hello') {
      // тык по жабе
      const pp = now - sc.poke;
      if (pp < 0.6) { const k = Math.sin(pp / 0.6 * Math.PI * 2.5) * (1 - pp / 0.6) * 0.13; f.sy *= 1 - k; f.sx *= 1 + k * 0.8; }
      if (pp < 1.6) { f.mouth = 'happy'; f.typing = false; f.bubble = 'Ква!'; }
      if (Math.random() < 0.035 && f.typing) sc.parts.push({ kind: 'glyph', text: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], x: Math.random() < 0.5 ? rnd(30, 70) : rnd(195, 235), y: rnd(170, 210), life: 0, max: rnd(1.4, 2.2), shade: Math.random() });
    } else if (sc.kind === 'water') {
      const L = 9;
      const p = lt % L;
      if (p < 0.1) sc.jumped = false;
      const fill = 5.6;
      if (p < fill) {
        const sim = ease(p / fill) * S.waterEvery * 1.9;       // симулированные минуты без воды
        const r = sim / S.waterEvery;
        f.glass = clamp(1 - r, 0, 1);
        f.dry = clamp((r - 0.55) / 1.2, 0, 0.92);
        f.mouth = r > 1 ? 'dry' : 'code';
        f.lid = 0.08 + f.dry * 0.38;
        if (r > 1.1) f.typing = false;
        setPill(sc, r < 1 ? `⏱ ${fmt(sim)} без воды` : `🥵 ${fmt(sim)} — пить!`);
      } else {
        const q = clamp((p - fill) / 1.1, 0, 1);
        f.glass = 1;
        f.dry = lerp(0.92, 0, ease(q));
        f.lid = 0.08 + f.dry * 0.38;
        f.mouth = 'happy'; f.typing = false;
        jumpAt(fill + 0.2);
        if (!sc.jumped && p > fill + 0.2) { sc.jumped = true; for (let i = 0; i < 6; i++) sc.parts.push({ kind: 'heart', text: '💧', x: rnd(90, 200), y: rnd(150, 210), life: 0, max: rnd(1, 1.6), shade: Math.random() }); }
        setPill(sc, '💧 Попил — снова сочная!');
      }
    } else if (sc.kind === 'stone') {
      const L = 10.5;
      const p = lt % L;
      if (p < 0.1) sc.jumped = false;
      const sit = 5, away = 7.8;
      if (p < sit) {
        const sim = ease(p / sit) * S.moveEvery * 1.6;
        const r = sim / S.moveEvery;
        f.stone = clamp((r - 0.55) / 1.05, 0, 0.92);
        if (f.stone > 0.6) f.mouth = 'flat';
        if (f.stone > 0.8) f.typing = false;
        setPill(sc, r < 1 ? `⏱ сидишь ${fmt(sim)}` : `🗿 сидишь ${fmt(sim)} — встань!`);
      } else if (p < away) {
        f.stone = 0.92; f.away = true; f.typing = false; f.glow = false; f.mouth = 'flat';
        if (Math.random() < 0.025) sc.parts.push({ kind: 'z', text: 'z', x: rnd(150, 175), y: 95, life: 0, max: 1.6, shade: 0 });
        setPill(sc, `🚶 ${S.breakAfter} мин без мыши — перерыв засчитан`);
      } else {
        if (!sc.jumped) { sc.jumped = true; burst(sc, 34, 'chunk'); }
        f.stone = lerp(0.92, 0, clamp((p - away) / 0.35, 0, 1));
        jumpAt(away);
        setPill(sc, '🤸 Вернулся — камень долой!');
      }
    } else if (sc.kind === 'pick') {
      f.typing = false;
      if (S.deathEnabled) {
        f.mouth = 'wavy'; f.wide = true; f.lid = 0;
        f.rot = Math.sin(now * 40) * 0.006;
        f.sweat = true;
      } else {
        f.mouth = 'happy';
        f.dy = -Math.abs(Math.sin(now * 3)) * 6;
        if (Math.random() < 0.03) sc.parts.push({ kind: 'heart', text: Math.random() < 0.5 ? '💚' : '🌱', x: rnd(70, 190), y: 110, life: 0, max: 1.6, shade: Math.random() });
      }
    }
    // моргание
    const bl = sc.blink;
    if (bl.t >= 0) { bl.t += 1 / 60; if (bl.t > 0.14) bl.t = -1; }
    else if (now > bl.next) { bl.t = 0; bl.next = now + rnd(2, 5); }
    if (bl.t >= 0) f.lid = Math.max(f.lid, 1 - Math.abs(bl.t - 0.07) / 0.07);
    return f;
  }

  function updateEyes(sc, now) {
    let tx = 0, ty = 4;
    const r = sc.cv.getBoundingClientRect();
    if (now - mouse.t < 4 && mouse.x >= 0) {
      // следим за курсором по всему окну
      const cx = r.left + sc.ox + 130 * sc.k, cy = r.top + sc.oy + 114 * sc.k;
      const dx = mouse.x - cx, dy = mouse.y - cy, d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 120);
      tx = (dx / d) * 6 * m; ty = (dy / d) * 6 * m;
    } else if (sc.kind === 'hello' || sc.kind === 'water' || sc.kind === 'stone') {
      ty = 6; tx = Math.sin(now * 0.7) * 2;      // смотрит в ноутбук
    }
    sc.eye.x = lerp(sc.eye.x, tx, 0.2);
    sc.eye.y = lerp(sc.eye.y, ty, 0.2);
  }

  function drawScene(sc, now, dt) {
    if (!sizeScene(sc)) return;
    const lt = now - sc.t0;
    updateEyes(sc, now);
    const f = sceneState(sc, now, lt);
    const C = colors(f.dry);
    const { g, og, dpr, k } = sc;
    const base = () => [dpr * k, 0, 0, dpr * k, dpr * sc.ox, dpr * sc.oy];

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sc.cv.width, sc.cv.height);
    g.setTransform(...base());
    // тень на столе
    g.fillStyle = 'rgba(29,59,38,0.13)';
    ell(g, 130, FLOOR + 2, 96 - Math.abs(f.dy) * 0.6, 7); g.fill();

    // тело — в offscreen, чтобы камень лёг только на жабу
    const layer = (fn) => {
      og.setTransform(1, 0, 0, 1, 0, 0);
      og.clearRect(0, 0, sc.off.width, sc.off.height);
      og.setTransform(...base());
      og.save(); frogTransform(og, f); fn(og); applyStone(og, f.stone, now); og.restore();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(sc.off, 0, 0);
      g.setTransform(...base());
    };
    layer((o) => drawBody(o, f, C));
    if (sc.kind !== 'pick') drawLaptop(g, f.glow);
    layer((o) => drawPaws(o, f, C));
    if (f.glass >= 0) drawGlass(g, f.glass, now);
    if (f.sweat) {
      const p = (now * 0.8) % 1;
      g.save(); g.globalAlpha = 1 - p;
      g.fillStyle = '#7cc8ff';
      g.beginPath(); const sx = 196, sy = 112 + p * 30;
      g.moveTo(sx, sy - 10); g.quadraticCurveTo(sx + 7, sy, sx, sy + 4); g.quadraticCurveTo(sx - 7, sy, sx, sy - 10); g.fill();
      g.restore();
    }
    tickParts(sc, g, dt);
    if (f.bubble) bubble(g, f.bubble);
  }

  // ================= слайды =================
  const N = 4;
  let cur = 0;
  const $track = $('track');
  const $dots = $('dots');
  for (let i = 0; i < N; i++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.setAttribute('aria-label', `Экран ${i + 1}`);
    d.addEventListener('click', () => go(i));
    $dots.appendChild(d);
  }
  document.querySelectorAll('canvas[data-scene]').forEach((cv) => scenes.push(makeScene(cv)));

  function go(i) {
    cur = clamp(i, 0, N - 1);
    $track.style.transform = `translateX(${-cur * 100}%)`;
    [...$dots.children].forEach((d, j) => d.classList.toggle('on', j === cur));
    $('bBack').hidden = cur === 0;
    $('bSkip').style.visibility = cur === N - 1 ? 'hidden' : 'visible';
    const last = cur === N - 1;
    $('bNext').textContent = last ? 'Поехали 🐸' : 'Дальше →';
    $('bNext').classList.toggle('big', false);
    const sc = scenes[cur];
    if (sc) { sc.t0 = performance.now() / 1000; sc.parts = []; sc.jumped = false; sc.lastPill = ''; }
    document.querySelectorAll('.slide').forEach((s, j) => s.setAttribute('aria-hidden', String(j !== cur)));
  }

  $('bBack').addEventListener('click', () => go(cur - 1));
  $('bNext').addEventListener('click', () => (cur === N - 1 ? finish() : go(cur + 1)));
  $('bSkip').addEventListener('click', () => go(N - 1));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(cur + 1);
    else if (e.key === 'ArrowLeft') go(cur - 1);
    else if (e.key === 'Enter' && cur === N - 1 && !(e.target instanceof HTMLButtonElement)) finish();
  });

  // ---------- выбор режима ----------
  function setMode(hard) {
    S.deathEnabled = hard;
    $('mHard').setAttribute('aria-checked', String(hard));
    $('mSoft').setAttribute('aria-checked', String(!hard));
    document.querySelectorAll('[data-hard]').forEach((el) => { el.style.display = hard ? '' : 'none'; });
    const pick = scenes.find((s) => s.kind === 'pick');
    if (pick) pick.parts = [];
  }
  $('mHard').addEventListener('click', () => { setMode(true); app.setSetting('deathEnabled', true); });
  $('mSoft').addEventListener('click', () => { setMode(false); app.setSetting('deathEnabled', false); });
  $('login').addEventListener('change', (e) => { S.launchAtLogin = e.target.checked; app.setSetting('launchAtLogin', e.target.checked); });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    // фиксируем выбор ещё раз — вдруг пользователь ничего не нажимал
    app.setSetting('deathEnabled', !!S.deathEnabled);
    app.setSetting('launchAtLogin', !!S.launchAtLogin);
    Promise.resolve(app.finishOnboarding()).catch((e) => console.error(e));
  }

  // тайминги в тексте берём из настроек
  function applyTexts() {
    const map = {
      water: fmt(S.waterEvery), move: fmt(S.moveEvery), break: fmt(S.breakAfter), nag: fmt(S.nagEvery),
      dieWater: fmt(S.waterEvery * DEATH_WATER), dieStone: fmt(S.moveEvery * DEATH_STONE),
    };
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = map[el.dataset.t]; });
    $('login').checked = !!S.launchAtLogin;
    setMode(S.deathEnabled !== false);
  }

  function apply(d) {
    if (!d || !d.settings) return;
    S = Object.assign({}, DEFAULTS, d.settings);
    applyTexts();
  }

  // ---------- цикл ----------
  let last = performance.now() / 1000;
  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    const sc = scenes[cur];
    if (sc) drawScene(sc, now, dt);
    requestAnimationFrame(frame);
  }

  // ?slide=N — открыть сразу нужный экран (для скриншотов)
  const qs = new URLSearchParams(location.search);
  applyTexts();
  go(Number(qs.get('slide')) || 0);
  Promise.resolve(app.getData()).then(apply).catch((e) => console.error(e));
  if (app.onUpdate) app.onUpdate((d) => { if (!finished) apply(d); });
  requestAnimationFrame(frame);
})();
