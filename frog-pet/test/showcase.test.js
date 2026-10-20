'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core');
const Show = require('../app/showcase');
const fs = require('node:fs');
const path = require('node:path');

let Ach = null;
try { Ach = require('../app/achievements'); } catch (e) { /* ачивки ещё не готовы */ }

const HAS_DEATH = typeof Core.createPet(null, {}, Date.now()).revive === 'function' && Core.DEATH_WATER > 0;
const NO_DEATH = HAS_DEATH ? false : 'в core.js ещё нет life/death/revive (пишет A1)';

// Фейковый ctl поверх настоящего core — как demo.js / main.js
function makeCtl(T0 = new Date(2026, 9, 19, 11, 0, 0).getTime()) {
  // timed: события с секундой сценария (c.clock), steps: что режиссёр сделал и когда
  const c = { now: T0, pet: null, A: null, events: [], unlocked: [], log: [], timed: [], steps: [], toasts: [], hud: [], clock: () => 0, fix: (ev) => ev };
  const check = (evs) => {
    if (!c.A) return;
    const fresh = c.A.check({ now: c.now, events: evs, view: c.pet.view(c.now), state: c.pet.serialize(), settings: Core.DEFAULTS }) || [];
    c.unlocked.push(...fresh.map((a) => a.id));
    const shown = fresh.filter((a) => Show.showAchievement(Show.SCRIPTS[c.name], a));
    c.shown = (c.shown || []).concat(shown.map((a) => a.id));
    shown.forEach((a) => c.toasts.push({ at: c.clock(), id: a.id }));
  };
  const took = (evs) => evs.forEach((e) => { c.fix(e); c.timed.push({ at: c.clock(), ev: e }); });
  c.ctl = {
    reset() {
      c.pet = Core.createPet(null, {}, c.now);
      c.pet.tick(c.now, 0);
      c.A = Ach ? Ach.createAchievements(null) : null;
      c.log.push('reset');
    },
    ff(minutes, idleSec) {
      let left = minutes * Core.MIN;
      const evs = [];
      while (left > 0) {
        const dt = Math.min(left, 20000);
        c.now += dt; left -= dt;
        evs.push(...c.pet.tick(c.now, idleSec || 0));
      }
      took(evs);
      c.steps.push({ at: c.clock(), cmd: 'ff', quiet: !evs.length });
      c.hud.push(hudOf(c));
      c.events.push(...evs);
      check(evs);
    },
    action(type, opts = {}) {
      c.log.push(type + (opts.silent ? ':silent' : ''));
      if (opts.silent) return Show.quiet(c.pet, type);
      c.steps.push({ at: c.clock(), cmd: 'action', type });
      let ev = null;
      if (type === 'drink') ev = c.pet.drink(c.now);
      else if (type === 'stretch') ev = c.pet.stretch(c.now);
      else if (type === 'snooze') c.pet.snooze(opts.kind, c.now, opts.minutes);
      else if (type === 'poke') ev = c.pet.poke();
      else if (type === 'revive' && c.pet.revive) ev = c.pet.revive(c.now);
      if (ev) { took([ev]); c.events.push(ev); }
      check(ev ? [ev] : []);
    },
    say(text) { c.log.push('say'); c.steps.push({ at: c.clock(), cmd: 'say', text }); assert.ok(text && text.length < 90, 'реплика короткая: ' + text); },
    event() {},
    caption(text) { c.steps.push({ at: c.clock(), cmd: 'caption', text }); assert.ok(text && text.length < 70, 'титр короткий: ' + text); },
  };
  return c;
}

// счётчики HUD 9:16 (как render() в demo.js): «💧 без воды N», «🪑 сидит N»; null — жаба мертва
function hudOf(c) {
  const v = c.pet.view(c.now);
  const dead = v.life === 'dead';
  return { at: c.clock(), water: dead ? null : Math.round((v.waterRatio || 0) * Core.DEFAULTS.waterEvery), sit: dead ? null : (v.sitMin || 0) };
}

// Фейковые часы для режиссёра
function fakeTimers() {
  const f = { t: 0, q: [], id: 0 };
  f.timers = {
    now: () => f.t,
    setTimeout: (fn, ms) => { const id = ++f.id; f.q.push({ id, at: f.t + ms, fn }); return id; },
    clearTimeout: (id) => { f.q = f.q.filter((x) => x.id !== id); },
  };
  f.advance = (ms) => {
    const end = f.t + ms;
    for (;;) {
      f.q.sort((a, b) => a.at - b.at);
      const n = f.q[0];
      if (!n || n.at > end) break;
      f.q.shift();
      f.t = n.at;
      n.fn();
    }
    f.t = end;
  };
  return f;
}

function play(name, T0) {
  const c = makeCtl(T0);
  const f = fakeTimers();
  c.name = name;
  const d = Show.createDirector(Show.SCRIPTS[name], c.ctl, { timers: f.timers });
  c.clock = () => f.t / 1000;
  c.fix = (ev) => d.line(ev);
  let ended = null, endAt = null;
  d.onEnd((r) => { ended = r; endAt = f.t; });
  d.start();
  f.advance(200 * 1000);
  return { c, d, ended, endAt };
}

// тост ачивки: 3.5 с + уход; несколько подряд идут очередью
const TOAST_SEC = 4;
const at = (c, pred) => c.events.findIndex(pred);

test('все сценарии на месте и с шагами по контракту', () => {
  for (const k of ['short', 'water', 'stone', 'tour']) {
    const s = Show.SCRIPTS[k];
    assert.ok(s && s.title && s.duration > 0 && s.steps.length, k);
    for (const st of s.steps) {
      assert.ok(['reset', 'ff', 'action', 'say', 'event', 'caption'].includes(st.cmd), k + ': ' + st.cmd);
      assert.ok(st.t >= 0 && st.t <= s.duration, `${k}: шаг на ${st.t} с за пределами ${s.duration} с`);
    }
    assert.strictEqual(s.steps[0].cmd, 'reset', k + ' начинается со сброса');
  }
  // две смерти с надгробием и вылуплением не влезают в 50 с — см. docs/shorts.md
  assert.ok(Show.SCRIPTS.short.duration <= 80, 'short не длиннее 80 с');
  assert.ok(Show.SCRIPTS.tour.duration <= 120, 'tour не длиннее 2 мин');
  for (const k of Object.keys(Show.SCRIPTS)) {
    // меню-бар сам дописывает « (~N с)» (r1-04-14)
    assert.ok(!/\d+\s*с\)/.test(Show.SCRIPTS[k].title), k + ': в title нет длительности');
  }
});

test('ff разворачивается в плавную серию мелких шагов', () => {
  const tape = Show.expand(Show.SCRIPTS.short);
  const ffs = tape.filter((s) => s.cmd === 'ff');
  assert.ok(ffs.length > 60, 'много порций');
  assert.ok(ffs.every((s) => s.minutes <= 3), 'порции не больше 3 мин');
  for (const k of Object.keys(Show.SCRIPTS)) {
    const t = Show.expand(Show.SCRIPTS[k]);
    assert.ok(t[t.length - 1].at <= Show.SCRIPTS[k].duration, k + ' укладывается в длительность');
    for (let i = 1; i < t.length; i++) assert.ok(t[i].at >= t[i - 1].at, 'лента по времени');
  }
});

test('режиссёр укладывается в длительность и вызывает onEnd', () => {
  for (const k of Object.keys(Show.SCRIPTS)) {
    const r = play(k);
    assert.strictEqual(r.ended, 'end', k);
    assert.ok(Math.abs(r.endAt / 1000 - Show.SCRIPTS[k].duration) < 0.5, `${k}: конец на ${r.endAt / 1000} с`);
  }
});

test('stop() останавливает: шаги больше не выполняются', () => {
  const c = makeCtl();
  const f = fakeTimers();
  const d = Show.createDirector(Show.SCRIPTS.short, c.ctl, { timers: f.timers });
  let reason = null;
  d.onEnd((r) => { reason = r; });
  d.start();
  f.advance(5000);
  const n = c.log.length, t = c.now;
  d.stop();
  f.advance(100 * 1000);
  assert.strictEqual(reason, 'stop');
  assert.strictEqual(c.log.length, n);
  assert.strictEqual(c.now, t);
  assert.strictEqual(f.q.length, 0, 'таймеров не осталось');
});

test('тихое удержание не даёт событий и статистики', () => {
  const pet = Core.createPet(null, {}, Date.now());
  const t0 = Date.now();
  pet.tick(t0, 0);
  pet.tick(t0 + 30 * Core.MIN, 1);
  assert.ok(Show.quiet(pet, 'stretch'));
  assert.strictEqual(pet.view(t0).sitMin, 0);
  assert.strictEqual(pet.view(t0).day.breaks, 0);
  assert.ok(pet.view(t0).waterRatio > 0.5, 'вода не тронута');
});

test('short: жаба засыхает, возрождается, окаменевает и снова живёт', { skip: NO_DEATH }, () => {
  const { c } = play('short');
  const dry = at(c, (e) => e.type === 'death' && e.cause === 'dry');
  const stone = at(c, (e) => e.type === 'death' && e.cause === 'stone');
  const critW = at(c, (e) => e.type === 'critical' && e.kind === 'water');
  const critM = at(c, (e) => e.type === 'critical' && e.kind === 'move');
  const remW = at(c, (e) => e.type === 'remind' && e.kind === 'water');
  const remM = at(c, (e) => e.type === 'remind' && e.kind === 'move');
  assert.ok(remW >= 0 && critW > remW && dry > critW, 'вода: напоминание → при смерти → смерть');
  assert.ok(remM > dry && critM > remM && stone > critM, 'камень: напоминание → при смерти → смерть');
  assert.strictEqual(c.events.filter((e) => e.type === 'death').length, 2, 'ровно две смерти');
  assert.strictEqual(c.events.filter((e) => e.type === 'reborn').length, 2);
  // засыхание не смешивается с окаменением и наоборот
  assert.ok(!c.events.slice(0, dry).some((e) => e.kind === 'move'), 'пока сохнет — без каменных напоминаний');
  assert.ok(!c.events.slice(dry, stone).some((e) => e.type === 'remind' && e.kind === 'water'), 'пока каменеет — без воды');
  const v = c.pet.view(c.now);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(v.generation, 3);
  assert.strictEqual(v.day.drinks, 1, 'в финале один честный стакан');
  assert.strictEqual(v.day.breaks, 0, 'тихие разминки не попали в статистику');
});

test('short: ачивки «Изюм», «Нефритовая» и «Железножопая»', { skip: NO_DEATH || (!Ach && 'нет achievements.js (пишет A2)') }, () => {
  const { c } = play('short');
  for (const id of ['raisin', 'jade', 'iron_butt']) assert.ok(c.unlocked.includes(id), id + ' в ' + c.unlocked.join(','));
  assert.ok(!c.unlocked.includes('first_stretch'), 'тихие разминки не дают ачивок');
});

test('water, stone и tour доводят жабу до нужной смерти', { skip: NO_DEATH }, () => {
  const w = play('water').c, s = play('stone').c, t = play('tour').c;
  assert.deepStrictEqual(w.events.filter((e) => e.type === 'death').map((e) => e.cause), ['dry']);
  assert.deepStrictEqual(s.events.filter((e) => e.type === 'death').map((e) => e.cause), ['stone']);
  assert.deepStrictEqual(t.events.filter((e) => e.type === 'death').map((e) => e.cause), ['dry', 'stone']);
  assert.ok(t.events.some((e) => e.type === 'back'), 'tour показывает авто-перерыв');
  for (const c of [w, s, t]) assert.strictEqual(c.pet.view(c.now).life, 'alive', 'в финале жаба жива');
});

test('сценарии одинаковы в любое время съёмки: ночь, утро, пятничный вечер, полночь', { skip: NO_DEATH || (!Ach && 'нет achievements.js') }, () => {
  // 23 окт 2026 — пятница
  const starts = [11, 0, 3, 7.5, 18, 23.5].map((h) => new Date(2026, 9, 23, Math.floor(h), (h % 1) * 60).getTime());
  for (const name of Object.keys(Show.SCRIPTS)) {
    const runs = starts.map((T0) => {
      const { c } = play(name, T0);
      return {
        story: c.events.filter((e) => ['death', 'reborn', 'critical', 'back'].includes(e.type)).map((e) => e.type + ':' + (e.cause || e.kind || '')).join(' '),
        shown: (c.shown || []).slice().sort().join(','),
        life: c.pet.view(c.now).life,
      };
    });
    for (const r of runs.slice(1)) {
      assert.strictEqual(r.story, runs[0].story, name + ': механика не зависит от часов');
      assert.strictEqual(r.shown, runs[0].shown, name + ': в кадре те же ачивки (без «Ночной жабы»/«Пятничного деплоя»)');
      assert.strictEqual(r.life, 'alive');
    }
  }
});

// ---------- режиссура (r1-04, круг 2) ----------

const NAMES = ['short', 'water', 'stone', 'tour'];
const capSec = (text) => Math.max(2.6, Math.min(6, text.length * 0.12));   // как caption() в demo.js
// подсказка, которую pet.js добавляет к облачку «при смерти»
const CRIT_TIP = 'Ещё немного — и я изюм.';

// Моменты, когда облачко жабы меняется: { at, text, kind }
function bubbleMoments(c) {
  const out = [];
  for (const { at, ev } of c.timed) {
    if (ev.type === 'remind') out.push({ at, kind: 'remind', text: ev.text + ' ' + (ev.tip || '') });
    else if (ev.type === 'critical') out.push({ at, kind: 'critical', text: ev.text + ' ' + CRIT_TIP });
    else if (ev.type === 'reborn') out.push({ at: at + Show.TIMING.hatch, kind: 'greet', text: ev.text });
    else if (ev.type === 'death') out.push({ at, kind: 'death', text: '' });
    else if (ev.text) out.push({ at, kind: ev.type, text: ev.text });
  }
  for (const s of c.steps) {
    if (s.cmd === 'say') out.push({ at: s.at, kind: 'say', text: s.text });
    if (s.cmd === 'action' && /^open/.test(s.type)) out.push({ at: s.at, kind: 'open', text: 'В приложении тут откроется окно с ачивками, графиками и кладбищем жаб.' });
  }
  out.sort((a, b) => a.at - b.at);
  // повтор того же напоминания (nag) не перебивает его, а продолжает
  return out.filter((m, i) => !(i && m.kind === out[i - 1].kind && m.text === out[i - 1].text));
}

test('death.js не медленнее, чем рассчитывают сценарии (TIMING)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/renderer/death.js'), 'utf8');
  const num = (obj, key) => {
    const m = src.match(new RegExp('const ' + obj + '\\s*=\\s*\\{[^}]*\\b' + key + ':\\s*([\\d.]+)'));
    assert.ok(m, `в death.js нет ${obj}.${key}`);
    return +m[1];
  };
  // надгробие поднимается ещё TOMB_RISE после T_*.tomb
  const rise = (src.match(/const TOMB_RISE\s*=\s*([\d.]+)/) || [0, 0.7])[1] * 1;
  assert.ok(num('T_DRY', 'tomb') + rise <= Show.TIMING.tomb.dry + 1e-9, 'надгробие после засыхания не позже TIMING.tomb.dry');
  assert.ok(num('T_STONE', 'tomb') + rise <= Show.TIMING.tomb.stone + 1e-9, 'надгробие после окаменения не позже TIMING.tomb.stone');
  assert.ok(num('T_EGG', 'done') <= Show.TIMING.hatch, 'вылупление не дольше TIMING.hatch');
});

test('надгробие в кадре ≥ 2.5 с перед каждым revive (r1-04-01)', { skip: NO_DEATH }, () => {
  for (const name of NAMES) {
    const { c } = play(name);
    const deaths = c.timed.filter((x) => x.ev.type === 'death');
    const revives = c.steps.filter((s) => s.cmd === 'action' && s.type === 'revive');
    assert.strictEqual(revives.length, deaths.length, name + ': на каждую смерть одно возрождение');
    deaths.forEach((d, i) => {
      const tomb = d.at + Show.TIMING.tomb[d.ev.cause];
      // считаем от облачка RIP с кнопкой «🥚» — оно появляется позже надгробия
      // тосты ачивок смерти идут очередью, облачко RIP ждёт под ними (~0.3 с на уход тоста)
      let q = d.at;
      c.toasts.filter((x) => x.at >= d.at - 0.01 && x.at <= d.at + 1).forEach((x) => { q = Math.max(q, x.at) + TOAST_SEC; });
      const rip = Math.max(d.at + Show.TIMING.rip[d.ev.cause], q > d.at ? q + 0.3 : 0);
      assert.ok(rip >= tomb, 'облачко RIP не раньше надгробия');
      const hold = revives[i].at - rip;
      // +0.25 с: в браузере шаги режиссёра опаздывают на такт таймера
      assert.ok(hold >= Show.TIMING.tombHold + 0.25, `${name}: надгробие #${i + 1} с облачком висит ${hold.toFixed(2)} с (смерть ${d.at.toFixed(2)}, revive ${revives[i].at})`);
      assert.ok(tomb + 0.1 <= Show.SCRIPTS[name].duration, name + ': надгробие успевает до конца');
    });
  }
});

test('пока жаба в яйце и здоровается — только титры (r1-04-05)', { skip: NO_DEATH }, () => {
  for (const name of NAMES) {
    const { c } = play(name);
    for (const r of c.timed.filter((x) => x.ev.type === 'reborn')) {
      const until = r.at + Show.TIMING.hatch + Show.readSec(r.ev.text);
      const busy = c.steps.filter((s) => s.at > r.at + 0.01 && s.at < until && s.cmd !== 'caption');
      assert.deepStrictEqual(busy.map((s) => `${s.at}:${s.cmd}:${s.type || ''}`), [], `${name}: шаги во время вылупления (${r.at}–${until.toFixed(1)} с)`);
      assert.ok(until <= Show.SCRIPTS[name].duration + 0.01, `${name}: приветствие успевает до конца сценария`);
    }
  }
});

test('облачко не перебивают: ≥ 2 с на 10 слов (r1-04-04)', { skip: NO_DEATH }, () => {
  for (const name of NAMES) {
    const { c } = play(name);
    const ms = bubbleMoments(c);
    ms.forEach((m, i) => {
      if (!m.text.trim()) return;
      const next = ms[i + 1];
      const end = next ? next.at : Show.SCRIPTS[name].duration;
      const need = Show.readSec(m.text);
      assert.ok(end - m.at >= need - 1e-6, `${name}: «${m.text.trim()}» (${m.kind}) висит ${(end - m.at).toFixed(2)} с из ${need.toFixed(1)}, потом ${next ? next.kind : 'конец'}`);
    });
  }
});

test('на съёмке фразы фиксированы: одинаковые в любом дубле (r1-04-08)', { skip: NO_DEATH }, () => {
  const real = Math.random;
  const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  try {
    for (const name of NAMES) {
      const takes = [1, 7, 4242].map((seed) => {
        Math.random = seeded(seed);
        const { c } = play(name);
        return c.timed.filter((x) => x.ev.text).map((x) => `${x.at.toFixed(2)} ${x.ev.type} ${x.ev.text} ${x.ev.tip || ''}`).join('\n');
      });
      assert.strictEqual(takes[1], takes[0], name + ': тексты второго дубля');
      assert.strictEqual(takes[2], takes[0], name + ': тексты третьего дубля');
    }
  } finally { Math.random = real; }
  // повторы берутся по очереди, {gen}/{min} подставляются
  const d = Show.createDirector(Show.SCRIPTS.tour, { reset() {} });
  assert.strictEqual(d.line({ type: 'poke', text: 'x' }).text, Show.LINES.poke[0]);
  assert.strictEqual(d.line({ type: 'poke', text: 'x' }).text, Show.LINES.poke[1]);
  assert.match(d.line({ type: 'reborn', generation: 3, text: 'x' }).text, /#3/);
  assert.match(d.line({ type: 'back', min: 6, text: 'x' }).text, /6 мин/);
  assert.match(d.line({ type: 'remind', kind: 'move', text: 'x', tip: 'y' }).tip, /потянись/);
  assert.strictEqual(d.line({ type: 'achievement', title: 'Изюм' }).title, 'Изюм', 'без текста событие не трогаем');
});

test('ачивки только из белого списка и не под титрами (r1-04-06, r1-04-09)', { skip: NO_DEATH || (!Ach && 'нет achievements.js') }, () => {
  for (const name of NAMES) {
    const s = Show.SCRIPTS[name];
    assert.ok(Array.isArray(s.achievements) && s.achievements.length, name + ': есть белый список');
    const { c } = play(name);
    assert.ok(c.shown.every((id) => s.achievements.includes(id)), name + ': ' + c.shown.join(','));
    // очередь тостов → интервалы на экране
    let free = 0;
    const shows = c.toasts.map((t) => { const a = Math.max(t.at, free); free = a + TOAST_SEC; return { id: t.id, a, b: free }; });
    for (const cp of c.steps.filter((x) => x.cmd === 'caption')) {
      const b = cp.at + capSec(cp.text);
      for (const t of shows) assert.ok(b <= t.a || cp.at >= t.b, `${name}: титр «${cp.text}» (${cp.at}) под тостом ${t.id} (${t.a}–${t.b})`);
    }
    // тост не прячет «при смерти» и напоминание: ачивка приходит вместе со смертью или в тишине
    for (const t of shows) {
      const bubble = bubbleMoments(c).filter((m) => m.kind === 'critical' || m.kind === 'remind').find((m) => m.at <= t.a && t.a < m.at + Show.readSec(m.text));
      const nearDeath = c.timed.some((x) => x.ev.type === 'death' && Math.abs(x.at - t.a) < 0.5);
      assert.ok(!bubble || nearDeath, `${name}: тост ${t.id} на ${t.a} закрывает «${bubble && bubble.text}»`);
    }
  }
});

test('у каждого сценария финал: CTA последним титром, жаба жива и вылупилась (r1-04-07)', { skip: NO_DEATH }, () => {
  for (const name of NAMES) {
    const s = Show.SCRIPTS[name];
    const caps = s.steps.filter((x) => x.cmd === 'caption');
    const last = caps[caps.length - 1];
    assert.match(last.text, /macOS|Ссылка|ссылка/, name + ': последний титр — CTA');
    assert.ok(last.t + capSec(last.text) <= s.duration + 0.5, `${name}: CTA дочитывается до конца (${last.t} + ${capSec(last.text)} > ${s.duration})`);
    const lastRevive = s.steps.filter((x) => x.cmd === 'action' && x.type === 'revive').pop();
    assert.ok(lastRevive.t + Show.TIMING.hatch < last.t + 0.5, name + ': CTA после вылупления');
  }
});

test('tour: перерыв в облачке совпадает с титром (r1-04-09, r1-02-05)', { skip: NO_DEATH }, () => {
  const { c } = play('tour');
  const back = c.timed.find((x) => x.ev.type === 'back');
  assert.ok(back, 'есть «С возвращением»');
  const capt = Show.SCRIPTS.tour.steps.find((x) => x.cmd === 'caption' && /Отошёл/.test(x.text));
  const m = capt.text.match(/(\d+) минут/);
  assert.ok(m, 'в титре есть минуты');
  assert.strictEqual(back.ev.min, +m[1], 'перерыв = сколько отходил');
});

test('docs/shorts.md согласован со сценариями: длины и титры short', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/shorts.md'), 'utf8');
  for (const name of NAMES) {
    const re = new RegExp('`' + name + '`\\s*\\|\\s*~' + Show.SCRIPTS[name].duration + ' с');
    assert.match(doc, re, `в таблице сценариев ${name} ~${Show.SCRIPTS[name].duration} с`);
  }
  for (const st of Show.SCRIPTS.short.steps.filter((x) => x.cmd === 'caption')) {
    assert.ok(doc.includes(st.text.replace(/\s*\p{Extended_Pictographic}+$/u, '').trim()), 'в docs/shorts.md нет титра short: ' + st.text);
  }
});

// ---------- круг 4 (G5) ----------

test('фразы смерти и возрождения на съёмке взяты из core (r1-05-08 regressed, r3-05-01)', () => {
  for (const cause of ['dry', 'stone']) {
    const line = Show.LINES['death:' + cause];
    assert.ok(Core.PHRASES['death_' + cause].includes(line), `death:${cause} «${line}» нет в core PHRASES.death_${cause}`);
  }
  assert.ok(Core.PHRASES.reborn.includes(Show.LINES.reborn), 'reborn из core');
  assert.ok(!JSON.stringify(Show.LINES).includes('Слишком долго сидели'), 'старая фраза-упрёк не вернулась');
});

// Титр в 9:16 до 2 строк по ~40 символов, а в окне жабы (260 px) — ещё уже, поэтому короче надёжнее
const len = (s) => [...String(s)].length;
test('титры короткие: ≤ 40 символов, влезают в 2 строки и в окне жабы (r1-04-02, r3-03-01)', () => {
  for (const name of Object.keys(Show.SCRIPTS)) {
    for (const st of Show.SCRIPTS[name].steps.filter((x) => x.cmd === 'caption')) {
      assert.ok(len(st.text) <= 40, `${name}: титр ${len(st.text)} символов: «${st.text}»`);
    }
  }
});

test('число в титре не спорит со счётчиком HUD в кадре (r3-04-03)', { skip: NO_DEATH }, () => {
  // «2 часа без воды», «1 ч 15 мин без перерыва», «45 минут не встаю» → минуты и счётчик
  const claim = (text) => {
    const m = text.match(/(\d+)\s*(ч|час\w*)(?:\s*(\d+)\s*мин\w*)?\s+(без воды|без перерыва|сидит|сижу|не встаю|не пью)|(\d+)\s*мин\w*\s+(без воды|без перерыва|сидит|сижу|не встаю|не пью)/);
    if (!m) return null;
    const min = m[1] ? +m[1] * 60 + (+m[3] || 0) : +m[5];
    const what = m[4] || m[6];
    return { min, key: /вод|пью/.test(what) ? 'water' : 'sit' };
  };
  for (const name of NAMES) {
    const { c } = play(name);
    for (const st of c.steps.filter((x) => x.cmd === 'caption')) {
      const k = claim(st.text);
      if (!k) continue;
      const end = st.at + capSec(st.text);
      // что показывал HUD, пока висел титр (последний снимок до начала + все снимки внутри)
      const before = c.hud.filter((h) => h.at <= st.at).pop();
      const shown = [before].concat(c.hud.filter((h) => h.at > st.at && h.at < end)).filter(Boolean).map((h) => h[k.key]);
      for (const v of shown) {
        assert.ok(v != null && Math.abs(v - k.min) <= 5, `${name}: титр «${st.text}» (${st.at} с) = ${k.min} мин, а счётчик ${v == null ? 'RIP' : v + ' мин'}`);
      }
    }
  }
});

test('титр о смерти — не раньше смерти, CTA с действием (r3-04-04)', { skip: NO_DEATH }, () => {
  for (const name of NAMES) {
    const { c } = play(name);
    const deaths = c.timed.filter((x) => x.ev.type === 'death').map((x) => x.at);
    for (const st of c.steps.filter((x) => x.cmd === 'caption' && /FATAL|hardened|RIP|умерла|засохла|окаменела|🪦/.test(x.text))) {
      assert.ok(deaths.some((d) => d <= st.at && st.at - d < 15), `${name}: титр «${st.text}» на ${st.at} с, а смерть на ${deaths.map((d) => d.toFixed(1))}`);
    }
    // облачко RIP уже говорит FATAL — титр его не повторяет
    for (const st of c.steps.filter((x) => x.cmd === 'caption')) {
      assert.ok(!/FATAL|hardened/.test(st.text), `${name}: титр повторяет облачко RIP: «${st.text}»`);
    }
  }
  for (const name of ['short', 'water', 'stone']) {
    const caps = Show.SCRIPTS[name].steps.filter((x) => x.cmd === 'caption');
    const last = caps[caps.length - 1].text;
    assert.match(last, /Ссылка|ссылка|Попей|Встань|Скачай/, `${name}: в CTA есть действие: «${last}»`);
  }
});

test('нет долгих пауз без титров: ≤ 16 с между титрами (r3-04-05)', () => {
  for (const name of Object.keys(Show.SCRIPTS)) {
    const s = Show.SCRIPTS[name];
    const ts = s.steps.filter((x) => x.cmd === 'caption').map((x) => x.t);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] <= 16, `${name}: ${ts[i - 1]}→${ts[i]} с без титров (${(ts[i] - ts[i - 1]).toFixed(1)} с)`);
    assert.ok(s.duration - ts[ts.length - 1] <= 16, name + ': хвост без титров');
  }
});

test('docs/shorts.md: для TikTok/Reels рекомендованы water и stone (решение круга 4)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/shorts.md'), 'utf8');
  assert.match(doc, /TikTok[^\n]*Reels[^\n]*`water`[^\n]*`stone`|TikTok[^\n]*Reels[^\n]*`stone`[^\n]*`water`/, 'строка-рекомендация water/stone для TikTok и Reels');
  assert.match(doc, /stage=desktop/, 'режим записи для десктопа описан');
  for (const name of ['water', 'stone']) {
    for (const st of Show.SCRIPTS[name].steps.filter((x) => x.cmd === 'caption')) {
      assert.ok(doc.includes(st.text.replace(/\s*\p{Extended_Pictographic}+$/u, '').trim()), `в docs/shorts.md нет титра ${name}: ${st.text}`);
    }
  }
});
