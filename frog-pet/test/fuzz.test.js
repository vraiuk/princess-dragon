'use strict';
// Фазз-симуляция: случайные «рабочие недели» по многим сидам и проверка инвариантов.
// Каждый сид — отдельный прогон из чистого состояния; падение печатает сид для воспроизведения:
//   FUZZ_SEED=123 node --test test/fuzz.test.js
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core');
const Ach = require('../app/achievements');

const { MIN, HOUR } = Core;
const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : Array.from({ length: Number(process.env.FUZZ_RUNS) || 40 }, (_, i) => 1000 + i);
const KIND_OF_CAUSE = { dry: 'water', stone: 'move' };

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function simulate(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  let settings = Object.assign({}, Core.DEFAULTS, { deathEnabled: r() < 0.8 });
  let t = new Date(2026, 9, 5, 8, 0, 0).getTime() + Math.floor(r() * 12 * HOUR);
  let pet = Core.createPet(null, settings, t);
  let ach = Ach.createAchievements(null);
  const unlocked = new Set();
  const log = [];
  let idleStart = t;            // когда человек последний раз трогал мышь
  let critSeen = { water: false, move: false };
  let checkMs = 0, checks = 0;

  const fail = (msg) => { throw new Error(`seed=${seed} t=${new Date(t).toISOString()}: ${msg}\n  last: ${log.slice(-6).join(' | ')}`); };

  function handle(events) {
    for (const ev of events) {
      log.push(ev.type + (ev.kind ? ':' + ev.kind : '') + (ev.cause ? ':' + ev.cause : ''));
      if (ev.type === 'critical') critSeen[ev.kind] = true;
      if (ev.type === 'death') {
        const k = KIND_OF_CAUSE[ev.cause];
        if (!k) fail(`неизвестная причина смерти ${ev.cause}`);
        if (!settings.deathEnabled) fail('смерть при выключенном хардкоре');
        if (!critSeen[k]) fail(`смерть (${ev.cause}) без предупреждения critical`);
        if ((t - idleStart) / 1000 >= settings.breakAfter * 60) fail('смерть, пока человек отошёл');
      }
      if (ev.type === 'reborn') critSeen = { water: false, move: false };
      if (ev.type === 'remind') {
        const v = pet.view(t);
        if (v.life === 'dead') fail('напоминание мёртвой жабе');
        if (v.paused) fail('напоминание на паузе');
      }
    }
    const t0 = process.hrtime.bigint();
    const got = ach.check({ now: t, events, view: pet.view(t), state: pet.serialize(), settings });
    checkMs += Number(process.hrtime.bigint() - t0) / 1e6; checks++;
    for (const a of got) {
      if (unlocked.has(a.id)) fail(`ачивка ${a.id} выдана повторно`);
      unlocked.add(a.id);
    }
  }

  function checkView() {
    const v = pet.view(t);
    for (const k of ['glass', 'dry', 'stone']) {
      if (!(v[k] >= 0 && v[k] <= 1)) fail(`view.${k}=${v[k]} вне [0,1]`);
    }
    if (v.life === 'dead' && !['dry', 'stone'].includes(v.cause)) fail(`мертва без причины: ${v.cause}`);
    const st = pet.serialize();
    if ((st.graveyard || []).length > 50) fail('кладбище больше 50');
    if ((st.history || []).length > 30) fail('history больше 30');
    const dates = (st.history || []).map((d) => d.date);
    if (new Set(dates).size !== dates.length) fail('дубли дат в history');
  }

  // один «шаг» поведения человека
  function step() {
    const mode = pick(['work', 'work', 'work', 'read', 'away', 'lunch', 'sleep', 'action', 'restart', 'settings']);
    if (mode === 'work' || mode === 'read') {
      const minutes = 5 + Math.floor(r() * 60);
      for (let i = 0; i < minutes * 3; i++) {
        t += 20 * 1000;
        if (mode === 'work' || r() < 0.2) idleStart = t - Math.floor(r() * 3000);
        handle(pet.tick(t, (t - idleStart) / 1000));
      }
    } else if (mode === 'away' || mode === 'lunch') {
      const minutes = mode === 'lunch' ? 40 + Math.floor(r() * 50) : 3 + Math.floor(r() * 15);
      for (let i = 0; i < minutes * 3; i++) { t += 20 * 1000; handle(pet.tick(t, (t - idleStart) / 1000)); }
      idleStart = t;
      t += 1000;
      handle(pet.tick(t, 0));
    } else if (mode === 'sleep') {
      t += (2 + r() * 14) * HOUR;          // крышка закрыта, тиков нет
      idleStart = t;
      handle(pet.tick(t, 0));
    } else if (mode === 'action') {
      idleStart = t;
      const a = pick(['drink', 'drink', 'stretch', 'snooze', 'poke', 'pause', 'revive', 'dragged']);
      let ev = null;
      if (a === 'drink') ev = pet.drink(t);
      else if (a === 'stretch') ev = pet.stretch(t);
      else if (a === 'snooze') { pet.snooze(pick(['water', 'move']), t, 10); ev = { type: 'snooze' }; }
      else if (a === 'poke') ev = pet.poke();
      else if (a === 'pause') ev = pet.pause(t, pick([0, 30, 60]));
      else if (a === 'revive' && pet.view(t).life === 'dead') ev = pet.revive(t);
      else if (a === 'dragged') ev = { type: 'dragged' };
      if (ev) handle([ev]);
    } else if (mode === 'restart') {
      pet = Core.createPet(JSON.parse(JSON.stringify(pet.serialize())), settings, t);
      ach = Ach.createAchievements(JSON.parse(JSON.stringify(ach.serialize())));
    } else if (mode === 'settings') {
      settings = Object.assign({}, settings, {
        waterEvery: pick([30, 45, 60, 90]), moveEvery: pick([30, 45, 50, 60, 90]), breakAfter: pick([3, 5, 10]),
      });
      pet.setSettings(settings);
      // смена хардкора поверх critical — сбрасываем ожидание предупреждения, core обязан выдать его заново
      if (r() < 0.15) { settings = Object.assign({}, settings, { deathEnabled: !settings.deathEnabled }); pet.setSettings(settings); critSeen = { water: false, move: false }; }
    }
    checkView();
  }

  handle(pet.tick(t, 0));
  const end = t + 14 * 24 * HOUR;
  while (t < end) step();
  return { seed, unlocked: unlocked.size, deaths: pet.view(t).totals.deaths, avgCheckMs: checkMs / checks };
}

test(`фазз: ${SEEDS.length} случайных недель без нарушений инвариантов`, () => {
  const results = SEEDS.map(simulate);
  const deaths = results.reduce((s, x) => s + x.deaths, 0);
  const avg = results.reduce((s, x) => s + x.avgCheckMs, 0) / results.length;
  // проверка самой проверки: смерти и ачивки вообще случаются, иначе фазз ничего не тестирует
  assert.ok(deaths > 0, 'ни одной смерти — симуляция слишком мягкая');
  assert.ok(results.every((x) => x.unlocked > 0), 'есть прогон без единой ачивки');
  assert.ok(avg < 2, `check() слишком медленный: ${avg.toFixed(3)} мс`);
});
