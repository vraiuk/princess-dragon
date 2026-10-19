'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core');
const Show = require('../app/showcase');

let Ach = null;
try { Ach = require('../app/achievements'); } catch (e) { /* ачивки ещё не готовы */ }

const HAS_DEATH = typeof Core.createPet(null, {}, Date.now()).revive === 'function' && Core.DEATH_WATER > 0;
const NO_DEATH = HAS_DEATH ? false : 'в core.js ещё нет life/death/revive (пишет A1)';

// Фейковый ctl поверх настоящего core — как demo.js / main.js
function makeCtl() {
  const T0 = new Date(2026, 9, 19, 11, 0, 0).getTime();
  const c = { now: T0, pet: null, A: null, events: [], unlocked: [], log: [] };
  const check = (evs) => {
    if (!c.A) return;
    const fresh = c.A.check({ now: c.now, events: evs, view: c.pet.view(c.now), state: c.pet.serialize(), settings: Core.DEFAULTS }) || [];
    c.unlocked.push(...fresh.map((a) => a.id));
  };
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
      c.events.push(...evs);
      check(evs);
    },
    action(type, opts = {}) {
      c.log.push(type + (opts.silent ? ':silent' : ''));
      if (opts.silent) return Show.quiet(c.pet, type);
      let ev = null;
      if (type === 'drink') ev = c.pet.drink(c.now);
      else if (type === 'stretch') ev = c.pet.stretch(c.now);
      else if (type === 'snooze') c.pet.snooze(opts.kind, c.now, opts.minutes);
      else if (type === 'poke') ev = c.pet.poke();
      else if (type === 'revive' && c.pet.revive) ev = c.pet.revive(c.now);
      if (ev) c.events.push(ev);
      check(ev ? [ev] : []);
    },
    say(text) { c.log.push('say'); assert.ok(text && text.length < 90, 'реплика короткая: ' + text); },
    event() {},
    caption(text) { assert.ok(text && text.length < 70, 'титр короткий: ' + text); },
  };
  return c;
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

function play(name) {
  const c = makeCtl();
  const f = fakeTimers();
  const d = Show.createDirector(Show.SCRIPTS[name], c.ctl, { timers: f.timers });
  let ended = null, endAt = null;
  d.onEnd((r) => { ended = r; endAt = f.t; });
  d.start();
  f.advance(200 * 1000);
  return { c, d, ended, endAt };
}

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
  assert.ok(Math.abs(Show.SCRIPTS.short.duration - 50) <= 8, 'short ~50 с');
  assert.ok(Math.abs(Show.SCRIPTS.tour.duration - 90) <= 10, 'tour ~90 с');
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
