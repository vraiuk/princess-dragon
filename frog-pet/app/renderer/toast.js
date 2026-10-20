// Тост «Ачивка получена!» внутри окна жабы: очередь, конфетти, звук WebAudio.
// API: FrogToast.show({ icon, title, desc, kind, rarity }), FrogToast.setSound(bool), FrogToast.clear(),
//      FrogToast.duration(a) — сколько висит тост, FrogToast.until(ms) — все тосты уйти к моменту ms (performance.now).
(function (root) {
  'use strict';

  // сколько висит тост: секунда на взгляд + ~25 символов/с на чтение, в пределах 3–6 с (r3-02-01)
  const DUR_MIN = 3000, DUR_MAX = 6000;
  const duration = (a) => Math.round(Math.min(DUR_MAX, Math.max(DUR_MIN, 1000 + 40 * (String(a.title || '').length + String(a.desc || '').length))));
  const BUSY_CUT = 800, DUR_BUSY = 2400;   // если в очереди есть ещё — бодрее, но не короче 2.4 с
  const OUT = 320;           // анимация ухода, мс
  const GAP = OUT + 120;     // от dismiss до следующего тоста
  const FAST = 1600;         // меньше этого тост перед надгробием не показываем
  const RIBBON = { good: 'Ачивка получена!', bad: 'Позорная ачивка', secret: 'Секретная ачивка!' };
  const RAR = { common: 'обычная', rare: 'редкая', epic: 'эпическая', legendary: 'легендарная' };   // как в трофеях
  const BURST = { common: 26, rare: 40, epic: 60, legendary: 95 };

  let sound = true;
  const queue = [];
  let busy = false, timer = 0, el = null, fx = null, fxCtx = null, parts = [], raf = 0;
  let deadline = 0, shownAt = 0, shownDur = 0;   // deadline: смерть — к подъёму надгробия тостов нет (r1-02-07)

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- DOM ----------
  function mount() {
    if (el) return;
    const host = document.getElementById('pet') || document.body;
    fx = document.createElement('canvas');
    fx.id = 'toast-fx';
    host.appendChild(fx);
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.title = 'Клик — закрыть';
    host.appendChild(el);
    el.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
  }

  function render(a) {
    const kind = RIBBON[a.kind] ? a.kind : 'good';
    const rarity = RAR[a.rarity] ? a.rarity : 'common';
    el.className = `k-${kind} r-${rarity}`;
    const ribbon = kind === 'bad' ? '💀 ' + RIBBON.bad : kind === 'secret' ? '🔮 ' + RIBBON.secret : '🏆 ' + RIBBON.good;
    el.innerHTML =
      '<div class="card">' +
        `<div class="ribbon"><span>${ribbon}</span><span class="rar">${RAR[rarity]}</span></div>` +
        `<div class="medal"><div class="rays"></div><span class="ic">${esc(a.icon || (kind === 'bad' ? '💩' : '🏅'))}</span></div>` +
        `<div class="body"><div class="title">${esc(a.title || 'Ачивка')}</div><div class="desc">${esc(a.desc || '')}</div></div>` +
        '<svg class="crack" viewBox="0 0 46 90" preserveAspectRatio="none"><path d="M30 0 L22 18 L31 30 L17 47 L26 58 L12 76 L18 90" fill="none" stroke="#1a0612" stroke-width="2.2" stroke-linejoin="round"/>' +
        '<path d="M22 18 L12 22 M17 47 L6 44 M26 58 L38 64" fill="none" stroke="#1a0612" stroke-width="1.4"/></svg>' +
        '<div class="skull">☠️</div>' +
        '<div class="shine"></div><div class="timer"></div>' +
      '</div>';
    return { kind, rarity };
  }

  // ---------- очередь ----------
  function show(a) {
    if (!a || typeof document === 'undefined') return;
    queue.push(a);
    if (!busy) next();
    else squeeze();
  }

  const clock = () => (root.performance ? performance.now() : Date.now());
  // До надгробия осталось left мс: сколько тостов (с текущим) успеет и по сколько висеть.
  // Последний должен начать уходить к deadline; кто не влез — пропускаем (он есть в Трофеях).
  function plan(left, n) {
    const k = Math.max(1, Math.min(n, Math.floor((left + GAP) / (FAST + GAP))));
    return { k, dur: Math.max(600, (left - GAP * (k - 1)) / k) };
  }
  const urgent = () => deadline && clock() < deadline;

  function next() {
    const a = queue.shift();
    if (!a) { busy = false; return; }
    busy = true;
    mount();
    const { kind, rarity } = render(a);
    // очередь — показываем бодрее, чтобы не отставать от событий
    let dur = queue.length ? Math.max(DUR_BUSY, duration(a) - BUSY_CUT) : duration(a);
    if (urgent()) {
      const p = plan(deadline - clock(), queue.length + 1);
      queue.splice(p.k - 1);
      dur = Math.min(dur, p.dur);
    }
    el.style.setProperty('--dur', Math.round(dur) + 'ms');
    void el.offsetWidth;            // перезапуск анимаций
    el.classList.add('show');
    burst(kind, rarity);
    play(kind, rarity);
    clearTimeout(timer);
    shownAt = clock(); shownDur = dur;
    timer = setTimeout(dismiss, dur);
  }

  // тост уже висит, а надгробие близко или очередь выросла — сократить его срок
  function squeeze() {
    if (!urgent() || !el || !el.classList.contains('show')) return;
    const now = clock();
    const p = plan(deadline - now, queue.length + 1);
    queue.splice(p.k - 1);
    const end = Math.min(shownAt + shownDur, now + p.dur);
    if (end >= shownAt + shownDur) return;
    const shownDurOld = shownDur;
    shownDur = end - shownAt;
    clearTimeout(timer);
    timer = setTimeout(dismiss, Math.max(0, end - now));
    const bar = el.querySelector('.timer');   // полоска времени доезжает до нуля к новому сроку
    if (bar) {
      const f = Math.max(0, 1 - (now - shownAt) / Math.max(1, shownDurOld));
      bar.style.animation = 'none'; bar.style.transform = `scaleX(${f.toFixed(3)})`;
      void bar.offsetWidth;
      bar.style.transition = `transform ${Math.round(Math.max(1, end - now))}ms linear`; bar.style.transform = 'scaleX(0)';
    }
  }

  // все тосты должны начать уходить к моменту ms (performance.now); 0 — снять ограничение
  function until(ms) {
    deadline = ms > 0 ? ms : 0;
    if (busy) squeeze();
  }

  function dismiss() {
    if (!el || !el.classList.contains('show')) return;
    clearTimeout(timer);
    el.classList.remove('show');
    el.classList.add('hide');
    timer = setTimeout(() => { el.classList.remove('hide'); next(); }, OUT + 120);
  }

  function clear() {
    queue.length = 0;
    clearTimeout(timer);
    if (el) el.className = '';
    parts = [];
    busy = false;
    deadline = 0;
  }

  // ---------- конфетти ----------
  const PAL = {
    good: ['#f7c843', '#ffe27a', '#3fae5a', '#7fd88f', '#fff4b8', '#e8a317'],
    bad: ['#5a5560', '#7d2350', '#3a2a40', '#8b7a8f', '#b5487a'],
    secret: ['#ff6b6b', '#ffb84d', '#ffe94d', '#6bdc7a', '#4dc3ff', '#9a7bff', '#ff6bd6'],
  };

  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function burst(kind, rarity) {
    if (!fx || reduced()) return;   // reduce: без конфетти, плашка и звук остаются
    const host = fx.parentNode;
    const w = host.clientWidth || 260, h = host.clientHeight || 320;
    const dpr = root.devicePixelRatio || 1;
    if (fx.width !== Math.round(w * dpr)) { fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr); }
    fxCtx = fx.getContext('2d');
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = PAL[kind];
    const n = kind === 'bad' ? Math.round(BURST[rarity] * 0.5) : BURST[rarity];
    const ox = 40, oy = 48;          // центр медали
    for (let i = 0; i < n; i++) {
      if (kind === 'bad') {
        // пепел и обломки сыплются вниз из трещины
        parts.push({
          x: w - 40 + (Math.random() - 0.5) * 30, y: 30 + Math.random() * 50,
          vx: (Math.random() - 0.5) * 1.2, vy: Math.random() * 1.5,
          g: 0.12, s: 2 + Math.random() * 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          c: pal[i % pal.length], shape: Math.random() < 0.6 ? 'rock' : 'dot', life: 70 + Math.random() * 40, t: 0, delay: 25 + Math.random() * 15,
        });
        continue;
      }
      const ang = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * (rarity === 'legendary' ? 6 : 4.5);
      const fromSide = i % 3 === 2;  // часть летит из правого края, чтобы покрыть всю карточку
      parts.push({
        x: fromSide ? w - 30 : ox, y: fromSide ? 30 : oy,
        vx: Math.cos(ang) * sp + (fromSide ? -1.5 : 1.2), vy: Math.sin(ang) * sp - 2.5,
        g: 0.16, s: 3 + Math.random() * 3.5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5,
        c: pal[i % pal.length],
        shape: kind === 'secret' ? (Math.random() < 0.5 ? 'star' : 'rect') : (Math.random() < 0.25 ? 'star' : Math.random() < 0.5 ? 'dot' : 'rect'),
        life: 80 + Math.random() * 50, t: 0, delay: 8 + Math.random() * 6,
      });
    }
    if (rarity === 'legendary' && kind !== 'bad') {
      // второй залп: дождь сверху
      for (let i = 0; i < 40; i++) {
        parts.push({
          x: Math.random() * w, y: -10 - Math.random() * 40, vx: (Math.random() - 0.5) * 1, vy: 1 + Math.random() * 2,
          g: 0.05, s: 3 + Math.random() * 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
          c: pal[i % pal.length], shape: i % 4 ? 'rect' : 'star', life: 120, t: 0, delay: 30 + Math.random() * 40,
        });
      }
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function star(c, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r, a = (i * Math.PI) / 5 - Math.PI / 2;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
  }

  function step() {
    const c = fxCtx;
    c.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter((p) => p.t < p.life + p.delay);
    for (const p of parts) {
      p.t++;
      if (p.t < p.delay) continue;
      p.vy += p.g; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      const k = p.t - p.delay, left = p.life - k;
      c.globalAlpha = Math.max(0, Math.min(1, left / 25));
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.c;
      if (p.shape === 'rect') { c.scale(1, Math.cos(k * 0.2 + p.rot)); c.fillRect(-p.s / 2, -p.s * 0.35, p.s, p.s * 0.7); }
      else if (p.shape === 'star') star(c, p.s * 0.9);
      else if (p.shape === 'rock') { c.beginPath(); c.moveTo(-p.s / 2, 0); c.lineTo(0, -p.s / 2); c.lineTo(p.s / 2, p.s / 4); c.lineTo(0, p.s / 2); c.fill(); }
      else { c.beginPath(); c.arc(0, 0, p.s / 2, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    c.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(step) : 0;
    if (!raf) c.clearRect(0, 0, fx.width, fx.height);
  }

  // ---------- звук ----------
  let ac = null, sleepTimer = 0;
  function audio() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ac) { try { ac = new AC(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  // самый длинный звук тоста ~1.6 с; потом контекст засыпает, чтобы не держать аудиопоток весь день
  function sleepSoon() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (ac && ac.state === 'running') ac.suspend().catch(() => {}); }, 3000);
  }

  function tone(c, out, { f, f2, at, len, type = 'triangle', vol = 0.2, vib = 0 }) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + len);
    if (vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = 6; lg.gain.value = vib;
      l.connect(lg); lg.connect(o.frequency); l.start(at); l.stop(at + len + 0.05);
    }
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + len + 0.05);
  }

  function play(kind, rarity) {
    if (!sound) return;
    const c = audio();
    if (!c) return;
    sleepSoon();
    const t = c.currentTime + 0.05;
    const out = c.createGain();
    out.gain.value = 0.55;
    out.connect(c.destination);
    if (kind === 'bad') {
      // грустный тромбон «вомп-вомп-вомп-воооомп»
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
      lp.connect(out);
      const notes = [[293.7, 277.2], [277.2, 261.6], [261.6, 246.9], [246.9, 220]];
      notes.forEach(([a, b], i) => {
        const last = i === notes.length - 1;
        tone(c, lp, { f: a, f2: b, at: t + i * 0.38, len: last ? 1.0 : 0.32, type: 'sawtooth', vol: 0.22, vib: last ? 7 : 0 });
      });
      return;
    }
    if (kind === 'secret') {
      // волшебный глиссандо вверх + искорки
      [523.3, 659.3, 784, 987.8, 1174.7, 1568].forEach((f, i) => tone(c, out, { f, at: t + i * 0.06, len: 0.5, type: 'sine', vol: 0.16 }));
      [2093, 2637, 3136].forEach((f, i) => tone(c, out, { f, at: t + 0.45 + i * 0.09, len: 0.35, type: 'sine', vol: 0.07 }));
      return;
    }
    // весёлое «дзынь»-арпеджио, на легендарке — с финальным аккордом
    const arp = [523.3, 659.3, 784, 1046.5];
    arp.forEach((f, i) => tone(c, out, { f, at: t + i * 0.075, len: 0.28, vol: 0.2 }));
    tone(c, out, { f: 2093, at: t + 0.3, len: 0.45, type: 'sine', vol: 0.09 });
    if (rarity === 'epic' || rarity === 'legendary') {
      [1046.5, 1318.5, 1568].forEach((f) => tone(c, out, { f, at: t + 0.42, len: rarity === 'legendary' ? 1.1 : 0.6, vol: 0.1 }));
    }
    if (rarity === 'legendary') {
      [1568, 2093, 2637, 3136].forEach((f, i) => tone(c, out, { f, at: t + 0.7 + i * 0.07, len: 0.3, type: 'sine', vol: 0.05 }));
    }
  }

  root.FrogToast = {
    show,
    setSound(on) { sound = !!on; },
    clear,
    duration,
    until,
    get busy() { return busy; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
