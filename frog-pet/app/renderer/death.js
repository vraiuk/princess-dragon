// Смерть и возрождение жабы: окаменение → камушки → пыль, засыхание → изюм → песок,
// надгробие, яйцо → головастик → жаба. pet.js вызывает эти функции каждый кадр.
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
  const easeOut = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const easeBack = (p) => { p = clamp(p, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const elastic = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -9 * p) * Math.sin((p * 8 - 0.75) * (2 * Math.PI) / 3) + 1);
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const now = () => performance.now() / 1000;
  const ell = (g, x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); };

  // геометрия окна (перезаписывается из init)
  let W = 260, H = 320, OY = 20, FLOOR = 268;
  let opt = { getDpr: () => 1 };
  const LID = 194;              // верх крышки ноутбука (координаты раскладки)

  // Таймлайны, секунды
  const T_STONE = { crack: 2.0, rest: 4.6, crumble: 5.9, wind: 5.7, ghost: 7.6, tomb: 8.6 };
  const T_DRY = { shrink: 2.6, raisin: 2.45, crack: 3.0, burst: 3.9, wind: 4.3, ghost: 6.4, tomb: 7.4 };
  const T_EGG = { fall: 0.3, land: 0.85, pop: 2.7, puff: 4.25, phones: 4.85, done: 5.7 };

  let mode = 'none';            // none | dying | dead | hatching
  let st = null;                // состояние текущей анимации
  let tomb = null;              // { t0, gen, cause, ageMin, wob }
  let parts = [];               // пыль, песок, искры, осколки скорлупы
  let pieces = [];              // камушки (картинки-осколки)
  let heap = [];                // карта высоты кучки
  let sound = true;

  // ---------- звук ----------
  let actx = null, noiseBuf = null;
  function audio() {
    if (!sound) return null;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (!noiseBuf) {
        noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return actx;
    } catch (e) { return null; }
  }
  function noise(dur, freq, vol, delay = 0, q = 0.8) {
    const a = audio(); if (!a) return;
    try {
      const t0 = a.currentTime + 0.01 + delay;
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = noiseBuf; s.loop = true;
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      s.connect(f).connect(g).connect(a.destination);
      s.start(t0); s.stop(t0 + dur + 0.05);
    } catch (e) { /* тишина */ }
  }
  function tone(f1, f2, dur, vol, delay = 0, type = 'triangle') {
    const a = audio(); if (!a) return;
    try {
      const t0 = a.currentTime + 0.01 + delay;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t0);
      o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* тишина */ }
  }
  const sfx = {
    crack: () => { noise(0.08, 2400, 0.25, 0, 2); noise(0.05, 900, 0.15, 0.05, 2); },
    shatter: () => { noise(0.6, 700, 0.5); noise(0.35, 2600, 0.25, 0.02, 1.5); tone(140, 50, 0.4, 0.25, 0, 'sine'); },
    clatter: () => { for (let i = 0; i < 7; i++) noise(0.05, rnd(1800, 3500), 0.12, 0.1 + i * rnd(0.06, 0.12), 3); },
    wind: () => { noise(2.2, 500, 0.12, 0, 0.5); noise(1.8, 1200, 0.06, 0.2, 0.7); },
    shrivel: () => { tone(420, 90, 1.8, 0.12, 0, 'sawtooth'); noise(1.6, 3500, 0.05); },
    poof: () => { noise(0.4, 1500, 0.25, 0, 0.6); },
    knock: () => { noise(0.04, 1600, 0.3, 0, 4); },
    pop: () => { tone(500, 1200, 0.12, 0.2, 0, 'sine'); noise(0.12, 3000, 0.15); },
    sparkle: () => { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, f * 1.01, 0.25, 0.08, i * 0.07, 'sine')); },
    croak: () => { [0, 0.17].forEach((d, i) => tone(i ? 300 : 380, i ? 170 : 220, 0.15, 0.16, d, 'sawtooth')); },
    sad: () => { tone(330, 220, 0.5, 0.1, 0, 'sine'); tone(262, 175, 0.7, 0.1, 0.45, 'sine'); },
  };

  // ---------- общие частицы ----------
  const MAXP = 420;
  function add(p) { if (parts.length < MAXP) parts.push(Object.assign({ life: 0, vx: 0, vy: 0, g: 0, drag: 0.5, wind: 0, rot: 0, vr: 0 }, p)); }

  function stepParts(g, dt, windK) {
    const keep = [];
    for (const p of parts) {
      p.life += dt;
      if (p.life > p.max) continue;
      if (p.x < -90 || p.x > W + 90 || p.y > H + 20 || p.y < -60) continue;
      // ветер: толкает вправо и чуть вверх, с завихрениями
      if (windK > 0 && p.wind) {
        const sw = Math.sin(p.y * 0.05 + p.life * 3 + p.ph);
        p.vx += (320 * windK * p.wind - p.vx * 0.6) * dt;
        p.vy += (-40 * windK * p.wind + sw * 90 * windK) * dt;
      }
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt * 0.5;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.floor && p.y > p.floor) { p.y = p.floor; p.vy *= -0.25; p.vx *= 0.7; }
      keep.push(p);
      const k = p.life / p.max;
      // у краёв окна гаснут, а не обрезаются ровной линией
      const edge = clamp(Math.min(p.x + 4, W - p.x, p.y) / 24, 0, 1);
      const a = (p.a == null ? 1 : p.a) * Math.min(1, (1 - k) * 2.5) * Math.min(1, p.life * 12) * edge;
      if (a <= 0.01) continue;
      g.globalAlpha = a;
      if (p.kind === 'dust') {
        g.fillStyle = p.c;
        const r = p.r * (1 + k * (p.grow || 0));
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      } else if (p.kind === 'grain') {
        g.fillStyle = p.c;
        g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      } else if (p.kind === 'pebble') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.c; g.strokeStyle = 'rgba(45,45,42,.8)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(-p.r, -p.r * 0.5); g.lineTo(p.r * 0.7, -p.r); g.lineTo(p.r, p.r * 0.6); g.lineTo(-p.r * 0.4, p.r); g.closePath();
        g.fill(); g.stroke(); g.restore();
      } else if (p.kind === 'spark') {
        const s = p.r * Math.sin(Math.PI * k);
        g.fillStyle = p.c;
        g.beginPath();
        for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.35 : s, an = i * Math.PI / 4 + p.rot; g.lineTo(p.x + Math.cos(an) * r, p.y + Math.sin(an) * r); }
        g.closePath(); g.fill();
      } else if (p.kind === 'ring') {
        g.strokeStyle = p.c; g.lineWidth = 3 * (1 - k) + 0.5;
        ell(g, p.x, p.y, p.r * (0.3 + k * 1.4), p.r * (0.3 + k * 1.4) * (p.sq || 1)); g.stroke();
      } else if (p.kind === 'shell') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = '#fff6df'; g.strokeStyle = '#6b5a3a'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(-p.r, 0); g.lineTo(-p.r * 0.3, -p.r * 0.8); g.lineTo(p.r * 0.8, -p.r * 0.3); g.lineTo(p.r * 0.5, p.r * 0.6); g.closePath();
        g.fill(); g.stroke(); g.restore();
      } else if (p.kind === 'bubble') {
        g.strokeStyle = 'rgba(190,230,255,.9)'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x + Math.sin(p.life * 6 + p.ph) * 2, p.y, p.r, 0, Math.PI * 2); g.stroke();
      } else if (p.kind === 'streak') {
        // полоска ветра
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i <= 10; i++) {
          const xx = p.x - i * p.len / 10;
          g.lineTo(xx, p.y + Math.sin(xx * 0.05 + p.ph) * 4);
        }
        g.stroke();
        if (p.curl) { g.beginPath(); g.arc(p.x + 4, p.y - 5, 5, Math.PI * 0.5, Math.PI * 2.1); g.stroke(); }
      } else if (p.kind === 'heart') {
        g.fillStyle = p.c; g.font = `${p.r}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(p.text, p.x, p.y);
      }
    }
    g.globalAlpha = 1;
    parts = keep;
  }

  function puff(x, y, n, col, spread = 1) {
    for (let i = 0; i < n; i++) {
      const an = rnd(0, Math.PI * 2), sp = rnd(30, 110) * spread;
      add({ kind: 'dust', x: x + rnd(-10, 10), y: y + rnd(-6, 6), vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.5 - 20, r: rnd(3, 7), grow: 1.4, c: col, a: rnd(0.35, 0.6), max: rnd(0.7, 1.3), drag: 2.5, wind: 0.6, ph: rnd(0, 6) });
    }
  }

  function windStreaks(n, y0, y1) {
    for (let i = 0; i < n; i++) {
      add({ kind: 'streak', x: rnd(-30, 60), y: rnd(y0, y1), vx: rnd(260, 380), len: rnd(30, 70), ph: rnd(0, 6), curl: Math.random() < 0.35, a: rnd(0.4, 0.8), max: rnd(1.0, 1.5), drag: 0 });
    }
  }

  // ---------- окаменение: трещины ----------
  function makeCracks() {
    const cr = [];
    const seeds = [[130, 150], [100, 118], [160, 118], [96, 176], [166, 176], [130, 120], [130, 220]];
    seeds.forEach(([sx, sy], si) => {
      const branches = 2 + (si === 0 ? 2 : 0);
      for (let b = 0; b < branches; b++) {
        let x = sx, y = sy, an = rnd(0, Math.PI * 2);
        const pts = [[x, y]];
        const n = 5 + Math.floor(rnd(0, 4));
        for (let k = 0; k < n; k++) { an += rnd(-0.7, 0.7); const l = rnd(6, 13); x += Math.cos(an) * l; y += Math.sin(an) * l; pts.push([x, y]); }
        cr.push({ pts, t0: si * 0.2 + b * 0.12 + rnd(0, 0.3) });
      }
    });
    return cr;
  }

  function drawCracks(g, cracks, el, glow) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const c of cracks) {
        const p = clamp((el - c.t0) / 0.7, 0, 1);
        if (p <= 0) continue;
        const n = (c.pts.length - 1) * p;
        g.beginPath(); g.moveTo(c.pts[0][0], c.pts[0][1]);
        for (let i = 1; i <= Math.ceil(n); i++) {
          const f = Math.min(1, n - (i - 1));
          const a = c.pts[i - 1], b = c.pts[i];
          g.lineTo(lerp(a[0], b[0], f), lerp(a[1], b[1], f));
        }
        if (pass === 0) { g.strokeStyle = 'rgba(28,30,28,.92)'; g.lineWidth = 2.2; }
        else { if (glow <= 0) continue; g.strokeStyle = `rgba(170,255,200,${glow})`; g.lineWidth = 0.9; }
        g.stroke();
      }
    }
  }

  // ---------- окаменение: разлом на камушки ----------
  function shatter() {
    const dpr = opt.getDpr();
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    const comp = document.createElement('canvas');
    comp.width = cw; comp.height = ch;
    const c = comp.getContext('2d', { willReadFrequently: true });
    c.drawImage(opt.back, 0, 0);
    // то, что за ноутбуком, не видно — вырезаем
    c.save(); c.scale(dpr, dpr);
    c.globalCompositeOperation = 'destination-out';
    c.fillRect(76, LID + OY + 2, 108, 80);
    c.restore();
    c.drawImage(opt.front, 0, 0);
    const data = c.getImageData(0, 0, cw, ch).data;
    const alphaAt = (x, y) => {
      const px = Math.floor(x * dpr), py = Math.floor(y * dpr);
      if (px < 0 || py < 0 || px >= cw || py >= ch) return 0;
      return data[(py * cw + px) * 4 + 3];
    };
    pieces = [];
    heap = new Array(Math.ceil(W / 4) + 2).fill(0);
    const S = 15, x0 = 46, y0 = 70 + OY, nx = 12, ny = 15;
    const grid = [];
    for (let j = 0; j <= ny; j++) {
      grid.push([]);
      for (let i = 0; i <= nx; i++) {
        const edge = i === 0 || j === 0 || i === nx || j === ny;
        grid[j].push([x0 + i * S + (edge ? 0 : rnd(-5, 5)), y0 + j * S + (edge ? 0 : rnd(-5, 5))]);
      }
    }
    const cx = 130, cy = 160 + OY;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = grid[j][i], b = grid[j][i + 1], d = grid[j + 1][i], e = grid[j + 1][i + 1];
        const r0 = Math.random();
        const tris = r0 < 0.45 ? [[a, b, e, d]] : r0 < 0.72 ? [[a, b, e], [a, e, d]] : [[a, b, d], [b, e, d]];
        for (const tri of tris) {
          const xs = tri.map((v) => v[0]), ys = tri.map((v) => v[1]);
          const mx = xs.reduce((a2, v) => a2 + v, 0) / tri.length, my = ys.reduce((a2, v) => a2 + v, 0) / tri.length;
          if (alphaAt(mx, my) < 60) continue;
          const minx = Math.floor(Math.min(...xs)) - 1, miny = Math.floor(Math.min(...ys)) - 1;
          const maxx = Math.ceil(Math.max(...xs)) + 1, maxy = Math.ceil(Math.max(...ys)) + 1;
          const w = maxx - minx, h = maxy - miny;
          const pc = document.createElement('canvas');
          pc.width = Math.ceil(w * dpr); pc.height = Math.ceil(h * dpr);
          const g = pc.getContext('2d');
          g.scale(dpr, dpr); g.translate(-minx, -miny);
          // скруглённый многоугольник — похоже на камушек, а не на стекло
          const n = tri.length, mid = (k) => [(tri[k % n][0] + tri[(k + 1) % n][0]) / 2, (tri[k % n][1] + tri[(k + 1) % n][1]) / 2];
          g.beginPath();
          g.moveTo(...mid(0));
          for (let k = 1; k <= n; k++) { const v = tri[k % n], m = mid(k); g.quadraticCurveTo(v[0], v[1], m[0], m[1]); }
          g.closePath();
          g.save(); g.clip();
          g.drawImage(comp, 0, 0, W, H);
          // серый камень + объём осколка
          g.fillStyle = `rgba(${125 + Math.random() * 40 | 0},${126 + Math.random() * 36 | 0},120,.62)`;
          g.fillRect(minx, miny, w, h);
          const gr = g.createLinearGradient(minx, miny, maxx, maxy);
          gr.addColorStop(0, 'rgba(255,255,255,.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
          g.fillStyle = gr; g.fillRect(minx, miny, w, h);
          g.restore();
          g.strokeStyle = 'rgba(38,40,38,.85)'; g.lineWidth = 1.3; g.lineJoin = 'round';
          g.stroke();
          const dx = mx - cx, dy = my - cy;
          pieces.push({
            img: pc, ox: mx - minx, oy: my - miny, w, h,
            x: mx, y: my, vx: dx * rnd(0.35, 1.0) + rnd(-20, 20), vy: dy * rnd(0.3, 0.9) - rnd(160, 340),
            rot: 0, vr: rnd(-7, 7), r: Math.max(w, h) * 0.42, depth: rnd(0, 12), rest: false,
            crumble: 0, shade: Math.random(),
          });
        }
      }
    }
  }

  function heapAt(x) { const b = Math.round(x / 4); return heap[b] || 0; }
  function heapAdd(x, amount) {
    const b = Math.round(x / 4);
    for (let k = -3; k <= 3; k++) {
      const i = b + k;
      if (i < 0 || i >= heap.length) continue;
      heap[i] = Math.min(26, heap[i] + amount * (1 - Math.abs(k) / 4));
    }
  }

  function stepPieces(g, dt, el) {
    const keep = [];
    for (const p of pieces) {
      if (!p.rest) {
        p.vy += 1150 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.x < 8) { p.x = 8; p.vx = Math.abs(p.vx) * 0.5; }
        if (p.x > W - 8) { p.x = W - 8; p.vx = -Math.abs(p.vx) * 0.5; }
        const ground = FLOOR + OY + p.depth - heapAt(p.x) - p.r * 0.45;
        if (p.y > ground) {
          p.y = ground;
          if (p.vy > 90) {
            p.vy = -p.vy * rnd(0.25, 0.42); p.vx *= 0.55; p.vr *= 0.5;
            if (Math.random() < 0.3) add({ kind: 'dust', x: p.x, y: p.y + 2, vx: rnd(-20, 20), vy: rnd(-25, -5), r: rnd(1.5, 3), grow: 1, c: '#bdbdb4', a: 0.5, max: 0.6, drag: 3 });
          } else {
            // скатывается с горки к краям
            const slope = heapAt(p.x - 4) - heapAt(p.x + 4);
            if (Math.abs(slope) > 5 && Math.abs(p.vx) < 200) { p.vx = -Math.sign(slope) * 40; p.vy = -10; p.x += p.vx * dt; }
            else { p.rest = true; p.vx = p.vy = 0; p.vr = 0; heapAdd(p.x, p.r * 0.32); }
          }
        }
      }
      // рассыпание в пыль (по очереди сверху вниз)
      if (el > T_STONE.rest && !p.cr0) p.cr0 = T_STONE.rest + (1 - clamp((p.y - 230) / 70, 0, 1)) * 0.6 + rnd(0, 0.6);
      let sc = 1;
      if (p.cr0 && el > p.cr0) {
        const k = clamp((el - p.cr0) / 0.45, 0, 1);
        sc = 1 - k;
        if (Math.random() < 0.6 * (1 - k) * dt * 30) {
          for (let i = 0; i < 2; i++) add({ kind: 'dust', x: p.x + rnd(-p.r, p.r), y: p.y + rnd(-p.r, p.r), vx: rnd(-15, 15), vy: rnd(-30, 0), r: rnd(1.4, 3.2), grow: 0.8, c: Math.random() < 0.5 ? '#a9aaa3' : '#cfd0c8', a: rnd(0.6, 0.9), max: rnd(2.2, 3.2), drag: 1.5, wind: rnd(0.7, 1.3), g: 8, ph: rnd(0, 6) });
        }
        if (k >= 1) continue;
      }
      keep.push(p);
      g.save();
      g.translate(p.x, p.y); g.rotate(p.rot); g.scale(sc, sc);
      g.drawImage(p.img, -p.ox, -p.oy, p.w, p.h);
      g.restore();
    }
    pieces = keep;
  }

  // ---------- засыхание: изюм ----------
  const RAISIN = { x: 130, y: LID - 9 };
  const raisinBumps = Array.from({ length: 9 }, () => rnd(0, Math.PI * 2));
  function drawRaisin(g, el, alpha, crack) {
    const x = RAISIN.x + (crack > 0 ? rnd(-1, 1) * crack * 1.6 : 0), y = RAISIN.y + OY;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    // комковатый силуэт
    const shape = () => {
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = i / 40 * Math.PI * 2;
        let r = 1;
        raisinBumps.forEach((b, k) => { r += Math.sin(a * (k % 3 + 3) + b) * 0.035; });
        g.lineTo(Math.cos(a) * 20 * r, Math.sin(a) * 12 * r);
      }
      g.closePath();
    };
    g.fillStyle = 'rgba(0,0,0,.25)';
    ell(g, 0, 11, 20, 3); g.fill();
    shape();
    const gr = g.createRadialGradient(-6, -5, 2, 0, 0, 22);
    gr.addColorStop(0, '#8a4a3a'); gr.addColorStop(0.5, '#5a2a24'); gr.addColorStop(1, '#2e1414');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#1e0c0c'; g.lineWidth = 1.8; g.stroke();
    // морщины изюма
    g.save(); shape(); g.clip();
    g.strokeStyle = 'rgba(25,8,8,.75)'; g.lineWidth = 1.2;
    const wr = [[-14, -3, 7, -0.2, 1.4], [-4, 4, 9, 3.4, 4.9], [8, -4, 8, 0.4, 2.2], [12, 5, 6, 3.6, 5.2], [-12, 6, 6, 4.4, 6], [2, -8, 7, 0.3, 2.6]];
    for (const [wx, wy, r, a0, a1] of wr) { g.beginPath(); g.arc(wx, wy, r, a0, a1); g.stroke(); }
    g.strokeStyle = 'rgba(200,120,100,.35)'; g.lineWidth = 1;
    for (const [wx, wy, r, a0, a1] of wr) { g.beginPath(); g.arc(wx, wy - 1.2, r, a0, a1); g.stroke(); }
    if (crack > 0) {
      g.strokeStyle = `rgba(230,190,140,${crack})`; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-18, -2); g.lineTo(-9, 1); g.lineTo(-3, -4); g.lineTo(5, 2); g.lineTo(12, -3); g.lineTo(19, 1);
      g.moveTo(-3, -4); g.lineTo(-1, -11); g.moveTo(5, 2); g.lineTo(7, 10); g.stroke();
    }
    g.restore();
    // блик
    g.fillStyle = 'rgba(255,220,200,.35)';
    ell(g, -8, -6, 5, 2, -0.3); g.fill();
    // глазки-крестики
    g.strokeStyle = '#f3e3d2'; g.lineWidth = 1.5; g.lineCap = 'round';
    for (const ex of [-6, 6]) {
      g.beginPath(); g.moveTo(ex - 2.2, -3.2); g.lineTo(ex + 2.2, 1.2); g.moveTo(ex + 2.2, -3.2); g.lineTo(ex - 2.2, 1.2); g.stroke();
    }
    // мини-наушники
    g.strokeStyle = '#1f2330'; g.lineWidth = 2.4;
    g.beginPath(); g.arc(0, 2, 19, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
    g.fillStyle = '#1f2330';
    g.beginPath(); g.roundRect(-22, -5, 5, 10, 2); g.fill();
    g.beginPath(); g.roundRect(17, -5, 5, 10, 2); g.fill();
    g.restore();
  }

  function burstSand() {
    const cols = ['#c9a36a', '#b0854a', '#8a5a34', '#6b3d26', '#d8bb84', '#5a2a24'];
    for (let i = 0; i < 300; i++) {
      const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random());
      const x = RAISIN.x + Math.cos(a) * 20 * r, y = RAISIN.y + OY + Math.sin(a) * 12 * r;
      add({ kind: 'grain', x, y, vx: Math.cos(a) * rnd(10, 70), vy: Math.sin(a) * rnd(10, 40) - rnd(20, 70), r: rnd(0.8, 1.9), c: cols[i % cols.length],
        g: 140, drag: 1.2, wind: rnd(0.6, 1.4), ph: rnd(0, 6), max: rnd(3.4, 5), floor: Math.random() < 0.4 ? FLOOR + OY + rnd(0, 8) : 0 });
    }
    puff(RAISIN.x, RAISIN.y + OY, 14, '#b08a5a', 0.8);
  }

  // ---------- призрак ----------
  function drawGhost(g, k, x0, y0) {
    if (k <= 0 || k >= 1) return;
    const a = Math.min(1, k * 4) * Math.min(1, (1 - k) * 2.5) * 0.85;
    const x = x0 + Math.sin(k * 9) * 8, y = y0 - k * 110;
    g.save();
    g.globalAlpha = a;
    g.translate(x, y);
    // нимб
    g.strokeStyle = '#ffd25a'; g.lineWidth = 3;
    ell(g, 0, -27, 13, 4); g.stroke();
    // тело-простынка
    g.fillStyle = 'rgba(240,250,255,.95)'; g.strokeStyle = 'rgba(120,150,170,.9)'; g.lineWidth = 1.5;
    g.beginPath();
    g.arc(-11, -12, 9, Math.PI, Math.PI * 2);
    g.arc(11, -12, 9, Math.PI, Math.PI * 2);
    g.quadraticCurveTo(24, -4, 22, 14);
    for (let i = 0; i <= 6; i++) g.lineTo(22 - i * 44 / 6, 14 + (i % 2 ? 6 : 0) + Math.sin(k * 30 + i) * 1.5);
    g.quadraticCurveTo(-24, -4, -20, -12);
    g.closePath(); g.fill(); g.stroke();
    // глазки и улыбка
    g.fillStyle = '#1d2a3a';
    for (const ex of [-11, 11]) { g.beginPath(); g.arc(ex, -12, 2.6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#1d2a3a'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, -2, 5, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = 'rgba(255,140,160,.6)';
    ell(g, -16, -3, 3.5, 2); g.fill(); ell(g, 16, -3, 3.5, 2); g.fill();
    g.restore();
  }

  // ---------- надгробие ----------
  function fmtAge(min) {
    min = Math.max(0, Math.round(min || 0));
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h >= 48) return `${Math.floor(h / 24)} дн ${h % 24} ч`;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }

  function drawTomb(g, t) {
    if (!tomb) return;
    const k = easeBack(seg(t, tomb.t0, tomb.t0 + 0.7));
    const sink = tomb.sink ? ease(seg(t, tomb.sink, tomb.sink + 0.45)) : 0;
    const dy = (1 - k) * 130 + sink * 140;
    const wob = tomb.wob ? Math.sin((t - tomb.wob) * 30) * 0.05 * Math.max(0, 1 - (t - tomb.wob) / 0.6) : 0;
    const x0 = 86, x1 = 174, top = 120 + OY;
    g.save();
    g.beginPath(); g.rect(0, 0, W, LID + OY + 6); g.clip();   // всё ниже уходит за ноутбук
    g.translate(130, LID + OY + dy); g.rotate(wob); g.translate(-130, -(LID + OY));
    // камень
    const path = () => {
      g.beginPath();
      g.moveTo(x0, LID + OY + 30);
      g.lineTo(x0, top + 34);
      g.bezierCurveTo(x0, top - 6, x1, top - 6, x1, top + 34);
      g.lineTo(x1, LID + OY + 30);
      g.closePath();
    };
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.save(); g.translate(5, 4); path(); g.fill(); g.restore();
    path();
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#c9cdc4'); gr.addColorStop(0.6, '#aab0a6'); gr.addColorStop(1, '#878d84');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#3c423d'; g.lineWidth = 2.5; g.stroke();
    // фактура, мох и трещинка
    g.save(); path(); g.clip();
    g.fillStyle = 'rgba(70,74,70,.25)';
    for (let i = 0; i < 26; i++) { const sx = x0 + ((i * 37) % 76), sy = top + ((i * 53) % 90); g.beginPath(); g.arc(sx, sy, 1 + (i % 3) * 0.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#6f8f3e';
    for (const [mx, my, r] of [[x0 + 4, top + 30, 7], [x0 + 12, top + 20, 5], [x1 - 6, top + 26, 6]]) { g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(50,52,50,.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x1 - 14, top + 6); g.lineTo(x1 - 18, top + 16); g.lineTo(x1 - 13, top + 24); g.stroke();
    g.restore();
    // надписи (гравировка)
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const engrave = (txt, y, font) => {
      g.font = font;
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(txt, 130.7, y + 0.8);
      g.fillStyle = '#2f3530'; g.fillText(txt, 130, y);
    };
    engrave('R.I.P.', top + 22, 'bold 17px Georgia, "Times New Roman", serif');
    engrave(`Жабка #${tomb.gen || 1}`, top + 40, 'bold 12px -apple-system, "Helvetica Neue", sans-serif');
    engrave(tomb.cause === 'dry' ? 'засохла в изюм' : 'окаменела', top + 55, '600 10px -apple-system, "Helvetica Neue", sans-serif');
    engrave(`⏳ ${fmtAge(tomb.ageMin)}`, top + 68, '10px -apple-system, "Helvetica Neue", sans-serif');
    // наушники на надгробии
    g.strokeStyle = '#1f2330'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.arc(130, top + 34, 50, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.strokeStyle = '#4a5268'; g.lineWidth = 2;
    g.beginPath(); g.arc(130, top + 34, 50, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    for (const [cx, dir] of [[x0 - 1, -1], [x1 + 1, 1]]) {
      g.fillStyle = '#1f2330';
      g.beginPath(); g.roundRect(cx - 7, top + 18, 14, 28, 6); g.fill();
      g.fillStyle = '#343b50';
      g.beginPath(); g.roundRect(cx - 4 - dir * 1.5, top + 21, 8, 22, 4); g.fill();
      g.fillStyle = '#ff5d5d';
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2);
      g.beginPath(); g.arc(cx + dir * 3, top + 24, 1.6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function drawFlowers(g, t, k) {
    if (k <= 0) return;
    g.save();
    for (const [x, c, h, ph] of [[26, '#ff9ac4', 16, 0], [40, '#ffd25a', 11, 1.5], [242, '#c4a7ff', 13, 3]]) {
      const s = easeBack(clamp(k * 1.4 - (x > 200 ? 0.3 : 0), 0, 1));
      if (s <= 0) continue;
      const by = FLOOR + OY + 2, sway = Math.sin(t * 1.6 + ph) * 2;
      g.strokeStyle = '#3f8f45'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, by); g.quadraticCurveTo(x - 2, by - h * s * 0.5, x + sway, by - h * s); g.stroke();
      g.fillStyle = '#5fb764';
      ell(g, x + 4, by - h * s * 0.4, 4 * s, 2 * s, -0.5); g.fill();
      g.fillStyle = c;
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4 + t * 0.3; ell(g, x + sway + Math.cos(a) * 3.5 * s, by - h * s + Math.sin(a) * 3.5 * s, 2.6 * s, 2.6 * s); g.fill(); }
      g.fillStyle = '#fff3b0';
      ell(g, x + sway, by - h * s, 1.8 * s, 1.8 * s); g.fill();
    }
    g.restore();
  }

  // ---------- яйцо и головастик ----------
  const EGG = { x: 130, y: 166, rx: 34, ry: 44 };
  const eggCrack = [[-34, 0], [-24, -6], [-16, 4], [-6, -7], [3, 3], [12, -6], [21, 4], [28, -4], [34, 0]];
  function eggPath(g) { ell(g, 0, 0, EGG.rx, EGG.ry); }

  function drawEgg(g, t, el) {
    // падение и приземление
    const fall = seg(el, T_EGG.fall, T_EGG.land);
    if (fall <= 0) return;
    let y = lerp(-80, EGG.y + OY, fall * fall);
    let sx = 1, sy = 1, rot = 0;
    const land = el - T_EGG.land;
    if (land > 0 && land < 0.35) { const k = Math.sin(land / 0.35 * Math.PI) * (1 - land / 0.35); sx = 1 + 0.18 * k; sy = 1 - 0.16 * k; }
    // покачивания всё сильнее, с паузами
    let crack = 0;
    for (const [b0, amp] of [[1.1, 0.10], [1.65, 0.16], [2.2, 0.24]]) {
      const k = el - b0;
      if (k > 0 && k < 0.45) rot += Math.sin(k * 30) * amp * (1 - k / 0.45);
      if (k > 0) crack = Math.max(crack, clamp(b0 / 2.2, 0, 1) * clamp(k / 0.15, 0, 1));
    }
    const popped = el >= T_EGG.pop;
    const fade = 1 - seg(el, T_EGG.puff, T_EGG.puff + 0.3);
    if (fade <= 0) return;
    g.save();
    g.globalAlpha = fade;
    g.translate(EGG.x, y + EGG.ry * (sy - 1) * -1);
    g.translate(0, EGG.ry); g.rotate(rot); g.scale(sx, sy); g.translate(0, -EGG.ry);
    g.beginPath(); g.rect(-60, popped ? -2 : -80, 120, 160); g.clip();
    // тень и скорлупа
    eggPath(g);
    const gr = g.createRadialGradient(-12, -16, 4, 0, 0, 50);
    gr.addColorStop(0, '#fffdf4'); gr.addColorStop(0.7, '#f3e7c9'); gr.addColorStop(1, '#d9c79c');
    g.fillStyle = gr; g.fill();
    g.save(); eggPath(g); g.clip();
    g.fillStyle = 'rgba(92,201,107,.55)';
    for (const [x, yy, r] of [[-14, -22, 6], [12, -10, 8], [-8, 12, 5], [16, 20, 6], [-20, 26, 4], [4, -32, 4]]) { ell(g, x, yy, r, r * 0.8); g.fill(); }
    if (popped) {
      // внутренность нижней половинки
      g.fillStyle = '#f7efd9';
      ell(g, 0, 0, EGG.rx - 3, 7); g.fill();
    }
    g.restore();
    eggPath(g);
    g.strokeStyle = '#6b5a3a'; g.lineWidth = 2.2; g.stroke();
    // зигзаг трещины
    if (crack > 0 && !popped) {
      const n = (eggCrack.length - 1) * crack;
      g.strokeStyle = '#5a4526'; g.lineWidth = 1.8; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(eggCrack[4][0], eggCrack[4][1]);
      // растёт из центра в обе стороны
      for (let i = 4; i >= Math.max(0, 4 - Math.ceil(n / 2)); i--) g.lineTo(eggCrack[i][0], eggCrack[i][1]);
      g.moveTo(eggCrack[4][0], eggCrack[4][1]);
      for (let i = 4; i <= Math.min(eggCrack.length - 1, 4 + Math.ceil(n / 2)); i++) g.lineTo(eggCrack[i][0], eggCrack[i][1]);
      g.stroke();
    }
    if (!popped) {
      g.fillStyle = 'rgba(255,255,255,.7)';
      ell(g, -14, -20, 6, 10, 0.4); g.fill();
    }
    g.restore();
  }

  function drawTadpole(g, t, el) {
    const k = seg(el, T_EGG.pop, T_EGG.pop + 0.6);
    if (k <= 0 || el > T_EGG.puff + 0.05) return;
    const rise = easeBack(k);
    const x = 130 + Math.sin((el - T_EGG.pop) * 3) * 10 * seg(el, T_EGG.pop + 0.5, T_EGG.pop + 0.8);
    const y = EGG.y + OY + 6 - rise * 46 + Math.sin(el * 5) * 3;
    const spin = seg(el, T_EGG.puff - 0.45, T_EGG.puff);
    const glow = spin;
    g.save();
    g.translate(x, y);
    g.rotate(spin * spin * Math.PI * 4);
    g.scale(1 + glow * 0.3, 1 + glow * 0.3);
    if (glow > 0) {
      const gg = g.createRadialGradient(0, 0, 2, 0, 0, 40);
      gg.addColorStop(0, `rgba(255,255,220,${glow})`); gg.addColorStop(1, 'rgba(255,255,220,0)');
      g.fillStyle = gg; ell(g, 0, 0, 40, 40); g.fill();
    }
    // хвостик-волна
    g.fillStyle = '#2f5a3a'; g.strokeStyle = '#173022'; g.lineWidth = 1.6;
    g.beginPath();
    const tail = [];
    for (let i = 0; i <= 10; i++) { const s = i / 10; tail.push([12 + s * 30, Math.sin(el * 14 - s * 5) * 7 * s]); }
    g.moveTo(10, -7);
    for (const [tx, ty] of tail) g.lineTo(tx, ty - 6 * (1 - (tx - 12) / 30) - 1);
    for (let i = tail.length - 1; i >= 0; i--) g.lineTo(tail[i][0], tail[i][1] + 6 * (1 - (tail[i][0] - 12) / 30) + 1);
    g.lineTo(10, 7);
    g.closePath(); g.fill(); g.stroke();
    // голова
    ell(g, 0, 0, 17, 15);
    const hg = g.createRadialGradient(-5, -6, 2, 0, 0, 18);
    hg.addColorStop(0, '#5fb76c'); hg.addColorStop(1, '#2f6a40');
    g.fillStyle = hg; g.fill(); g.stroke();
    // глазищи
    for (const ex of [-7, 5]) {
      g.fillStyle = '#fffef6'; ell(g, ex, -5, 6, 6.5); g.fill();
      g.strokeStyle = '#173022'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = '#18201a'; ell(g, ex - 1, -4, 3.4, 3.8); g.fill();
      g.fillStyle = '#fff'; ell(g, ex - 2.2, -5.6, 1.3, 1.3); g.fill();
    }
    g.strokeStyle = '#173022'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(-1, 4, 4, 0.3, Math.PI - 0.3); g.stroke();
    g.fillStyle = 'rgba(255,130,150,.6)';
    ell(g, -12, 4, 3, 1.8); g.fill(); ell(g, 9, 4, 3, 1.8); g.fill();
    g.restore();
  }

  // ---------- API ----------
  function sweep() { parts = []; pieces = []; heap = []; }

  const FrogDeath = {
    // opts: { W, H, OY, FLOOR, back, front, getDpr, onTomb(info), onHatched(info) }
    init(o) {
      opt = Object.assign(opt, o || {});
      W = opt.W || W; H = opt.H || H; OY = opt.OY != null ? opt.OY : OY; FLOOR = opt.FLOOR || FLOOR;
    },
    setSound(b) { sound = !!b; },
    get mode() { return mode; },
    isDead() { return mode === 'dying' || mode === 'dead'; },
    busy() { return mode !== 'none'; },

    // начать анимацию смерти; info = { generation, ageMin, text }
    die(cause, info = {}) {
      if (mode === 'dying') return;
      sweep();
      tomb = null;
      mode = 'dying';
      st = { kind: cause === 'dry' ? 'dry' : 'stone', t0: now(), info, cracks: makeCracks(), flags: {} };
      if (st.kind === 'dry') sfx.shrivel();
    },
    // сразу надгробие, без анимации
    setDead(cause, info = {}) {
      sweep();
      mode = 'dead';
      st = null;
      tomb = { t0: now() - 5, gen: info.generation, cause: cause === 'dry' ? 'dry' : 'stone', ageMin: info.ageMin, info, flowers: now() - 5 };
    },
    // возрождение: яйцо → головастик → жаба
    reborn(info = {}) {
      const t = now();
      if (tomb) { tomb.sink = t; puff(130, LID + OY - 4, 12, '#c9cdc4'); }
      pieces = []; heap = [];
      mode = 'hatching';
      st = { kind: 'egg', t0: t, info, flags: {} };
    },
    reset() { sweep(); mode = 'none'; st = null; tomb = null; },
    stats() { return { parts: parts.length, pieces: pieces.length, heap: heap.length, tomb: !!tomb }; },
    info() { return tomb ? { generation: tomb.gen, cause: tomb.cause, ageMin: tomb.ageMin, text: tomb.info && tomb.info.text } : null; },
    fmtAge,
    // клик по надгробию — оно покачивается
    poke() { if (tomb && mode === 'dead') { tomb.wob = now(); sfx.knock(); } },

    // как рисовать живую жабу в этот момент (null — как обычно)
    frogFx(t) {
      if (mode === 'none') return null;
      if (mode === 'dead') return { show: false };
      const el = t - st.t0;
      if (st.kind === 'stone') {
        if (el >= T_STONE.crack) return { show: false };
        const p = el / T_STONE.crack;
        return { show: true, stone: 1, shake: 0.4 + 3.2 * p * p, faceDead: true };
      }
      if (st.kind === 'dry') {
        if (el >= T_DRY.crack) return { show: false };
        const p = ease(seg(el, 0, T_DRY.shrink));
        return {
          show: true, dry: 1, shake: 0.6 + 1.6 * p,
          scale: lerp(1, 0.22, p), sx: 1 + 0.12 * p, ax: 130, ay: LID + 4,
          alpha: 1 - seg(el, T_DRY.raisin, T_DRY.raisin + 0.35), faceDead: true,
        };
      }
      // вылупление
      if (el < T_EGG.puff) return { show: false };
      const k = seg(el, T_EGG.puff, T_EGG.puff + 0.75);
      return {
        show: true, scale: lerp(0.25, 1, elastic(k)), ax: 130, ay: FLOOR,
        phonesDY: el < T_EGG.phones ? null : -150 * (1 - easeOut(seg(el, T_EGG.phones, T_EGG.phones + 0.4))) + Math.sin(seg(el, T_EGG.phones + 0.4, T_EGG.phones + 0.8) * Math.PI * 2) * 4 * (1 - seg(el, T_EGG.phones + 0.4, T_EGG.phones + 0.8)),
        hidePhones: el < T_EGG.phones, happy: true,
      };
    },

    // накладка поверх жабы (source-atop, координаты раскладки)
    decorate(g, t, layer) {
      if (mode !== 'dying') return;
      const el = t - st.t0;
      g.save();
      g.globalCompositeOperation = 'source-atop';
      if (st.kind === 'stone') {
        const p = el / T_STONE.crack;
        drawCracks(g, st.cracks, el, clamp((p - 0.45) * 1.8, 0, 0.9));
        // вспышка перед разломом
        const fl = seg(el, T_STONE.crack - 0.25, T_STONE.crack);
        if (fl > 0) { g.fillStyle = `rgba(220,255,230,${fl * 0.75})`; g.fillRect(0, 0, W, H); }
      } else if (st.kind === 'dry') {
        const p = seg(el, 0, T_DRY.shrink);
        g.fillStyle = `rgba(105,52,30,${0.75 * p})`;
        g.fillRect(0, 0, W, H);
        g.strokeStyle = `rgba(40,15,8,${0.8 * p})`; g.lineWidth = 2.5;
        for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(80 + i * 13, 130 + (i % 3) * 18, 14, Math.PI * (1.1 + (i % 2) * 0.2), Math.PI * (1.7 + (i % 2) * 0.2)); g.stroke(); }
      }
      g.restore();
    },

    // за жабой и ноутбуком: надгробие, яйцо, головастик, призрак
    drawBehind(g, t, dt) {
      if (tomb) {
        drawTomb(g, t);
        if (tomb.sink && t - tomb.sink > 0.6) tomb = null;
      }
      if (mode === 'hatching') {
        const el = t - st.t0;
        drawEgg(g, t, el);
        drawTadpole(g, t, el);
      }
    },

    // перед ноутбуком и стаканом: камушки, изюм, песок, пыль, ветер
    drawFront(g, t, dt) {
      let windK = 0;
      if (mode === 'dying') {
        const el = t - st.t0, f = st.flags;
        if (st.kind === 'stone') {
          // осыпаются крошки во время трещин
          if (el < T_STONE.crack && Math.random() < el / T_STONE.crack * 0.8) {
            add({ kind: 'pebble', x: rnd(80, 180), y: rnd(110, 200) + OY, vx: rnd(-30, 30), vy: rnd(-40, 0), r: rnd(1.5, 3), c: '#9a9b94', g: 900, max: 0.9, floor: FLOOR + OY + rnd(0, 6), vr: rnd(-8, 8), drag: 0.2 });
          }
          if (!f.c1 && el > 0.35) { f.c1 = 1; sfx.crack(); }
          if (!f.c2 && el > 0.95) { f.c2 = 1; sfx.crack(); }
          if (!f.c3 && el > 1.5) { f.c3 = 1; sfx.crack(); }
          if (!f.burst && el >= T_STONE.crack) {
            f.burst = 1;
            shatter();
            sfx.shatter(); sfx.clatter();
            puff(130, 170 + OY, 26, '#c7c8c0', 1.4);
            add({ kind: 'ring', x: 130, y: 170 + OY, r: 70, sq: 0.8, c: 'rgba(220,255,230,.9)', max: 0.45 });
          }
          if (pieces.length) stepPieces(g, dt, el);
          if (!f.wind && el > T_STONE.wind) { f.wind = 1; sfx.wind(); windStreaks(8, 180 + OY, 300); }
          if (f.wind && !f.w2 && el > T_STONE.wind + 0.7) { f.w2 = 1; windStreaks(6, 170 + OY, 300); }
          windK = seg(el, T_STONE.wind, T_STONE.wind + 0.6);
          drawGhost(g, seg(el, T_STONE.ghost, T_STONE.ghost + 1.8), 130, 200 + OY);
          if (el >= T_STONE.tomb) this._toTomb(t);
        } else {
          const crack = seg(el, T_DRY.crack, T_DRY.burst);
          if (el > T_DRY.raisin && el < T_DRY.burst) {
            drawRaisin(g, el, seg(el, T_DRY.raisin, T_DRY.raisin + 0.3), crack);
          }
          if (!f.c1 && el > T_DRY.crack + 0.2) { f.c1 = 1; sfx.crack(); }
          if (!f.c2 && el > T_DRY.crack + 0.6) { f.c2 = 1; sfx.crack(); }
          // пар от засыхающей жабы
          if (el < T_DRY.shrink && Math.random() < 0.5) add({ kind: 'dust', x: rnd(90, 170), y: lerp(140, 200, el / T_DRY.shrink) + OY, vx: rnd(-8, 8), vy: rnd(-40, -20), r: rnd(3, 6), grow: 1.5, c: '#f2dcc0', a: 0.35, max: 1.0, drag: 1 });
          if (!f.burst && el >= T_DRY.burst) { f.burst = 1; burstSand(); sfx.poof(); }
          if (!f.wind && el > T_DRY.wind) { f.wind = 1; sfx.wind(); windStreaks(8, 150 + OY, 300); }
          if (f.wind && !f.w2 && el > T_DRY.wind + 0.7) { f.w2 = 1; windStreaks(6, 140 + OY, 300); }
          windK = seg(el, T_DRY.wind, T_DRY.wind + 0.5);
          drawGhost(g, seg(el, T_DRY.ghost, T_DRY.ghost + 1.8), 130, 200 + OY);
          if (el >= T_DRY.tomb) this._toTomb(t);
        }
      } else if (mode === 'hatching') {
        const el = t - st.t0, f = st.flags;
        if (!f.land && el > T_EGG.land) { f.land = 1; sfx.knock(); puff(130, LID + OY, 8, '#e8e2cf', 0.6); }
        for (const [i, b0] of [[1, 1.1], [2, 1.65], [3, 2.2]]) if (!f['k' + i] && el > b0) { f['k' + i] = 1; sfx.knock(); }
        if (!f.pop && el > T_EGG.pop) {
          f.pop = 1; sfx.pop();
          add({ kind: 'shell', x: 130, y: EGG.y + OY - 14, vx: rnd(-80, 80), vy: -320, r: 26, vr: rnd(-9, 9), g: 900, max: 1.4, drag: 0 });
          for (let i = 0; i < 10; i++) add({ kind: 'shell', x: 130 + rnd(-30, 30), y: EGG.y + OY - 2, vx: rnd(-150, 150), vy: rnd(-260, -80), r: rnd(3, 7), vr: rnd(-12, 12), g: 900, max: 1.2, drag: 0, floor: FLOOR + OY + rnd(0, 8) });
          for (let i = 0; i < 12; i++) add({ kind: 'spark', x: 130 + rnd(-40, 40), y: EGG.y + OY + rnd(-40, 10), r: rnd(4, 8), c: i % 2 ? '#ffe680' : '#ffffff', max: rnd(0.5, 0.9), rot: rnd(0, 1) });
        }
        if (el > T_EGG.pop + 0.3 && el < T_EGG.puff && Math.random() < 0.3) add({ kind: 'bubble', x: 130 + rnd(-20, 20), y: EGG.y + OY - 40, vy: -40, r: rnd(2, 4), ph: rnd(0, 6), max: 1, drag: 0 });
        if (!f.puff && el > T_EGG.puff) {
          f.puff = 1; sfx.sparkle();
          add({ kind: 'ring', x: 130, y: 160 + OY, r: 80, c: 'rgba(255,240,170,.95)', max: 0.5 });
          add({ kind: 'ring', x: 130, y: 160 + OY, r: 55, c: 'rgba(255,255,255,.9)', max: 0.4 });
          puff(130, 160 + OY, 18, '#ffffff', 1.3);
          for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; add({ kind: 'spark', x: 130 + Math.cos(a) * 30, y: 160 + OY + Math.sin(a) * 30, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: rnd(5, 9), c: ['#ffe680', '#9ff0b0', '#ffffff', '#ff9ac4'][i % 4], max: rnd(0.6, 1), drag: 3 }); }
          for (let i = 0; i < 4; i++) add({ kind: 'heart', text: '💚', x: 130 + rnd(-60, 60), y: 150 + OY, vy: rnd(-70, -40), vx: rnd(-20, 20), r: rnd(12, 16), max: 1.6, drag: 0.3 });
        }
        if (!f.phones && el > T_EGG.phones + 0.4) { f.phones = 1; sfx.knock(); sfx.croak(); }
        if (el > T_EGG.done) {
          mode = 'none';
          const info = st.info; st = null;
          opt.onHatched && opt.onHatched(info);
        }
      }
      if (tomb && mode === 'dead') drawFlowers(g, t, seg(t, tomb.flowers || tomb.t0, (tomb.flowers || tomb.t0) + 0.8));
      if (parts.length) stepParts(g, dt, windK);
    },

    _toTomb(t) {
      const info = st.info || {};
      tomb = { t0: t, gen: info.generation, cause: st.kind, ageMin: info.ageMin, info, flowers: t + 0.5 };
      mode = 'dead';
      st = null;
      pieces = [];
      sfx.sad();
      puff(130, LID + OY - 2, 10, '#c9cdc4', 0.8);
      opt.onTomb && opt.onTomb(this.info());
    },
  };

  window.FrogDeath = FrogDeath;
})();
