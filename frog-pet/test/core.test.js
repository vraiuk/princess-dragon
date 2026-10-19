'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPet, MIN, HOUR, DEATH_WATER, DEATH_STONE, CRITICAL, DEFAULTS } = require('../app/core');

const T0 = new Date(2026, 9, 19, 10, 0, 0).getTime();

// Прокручивает время по минуте, idle(t) задаёт простой в секундах
function run(pet, from, minutes, idle = () => 1) {
  const events = [];
  let t = from;
  for (let i = 0; i < minutes; i++) {
    t += MIN;
    events.push(...pet.tick(t, idle(t)));
  }
  return { t, events };
}

test('свежая жаба: полный стакан, не сухая, не каменная', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const v = pet.view(T0);
  assert.strictEqual(v.glass, 1);
  assert.strictEqual(v.dry, 0);
  assert.strictEqual(v.stone, 0);
});

test('напоминание о воде приходит по интервалу и повторяется через nagEvery', () => {
  const pet = createPet(null, { waterEvery: 30, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  const { events } = run(pet, T0, 45);
  const reminders = events.filter((e) => e.type === 'remind' && e.kind === 'water');
  assert.strictEqual(reminders.length, 2); // на 30-й и 40-й минуте
  assert.ok(reminders[0].text.length > 0);
});

test('попил — стакан снова полный, счётчик растёт', () => {
  const pet = createPet(null, { waterEvery: 30 }, T0);
  pet.tick(T0, 0);
  const { t } = run(pet, T0, 50);
  assert.ok(pet.view(t).dry > 0);
  const ev = pet.drink(t);
  assert.strictEqual(ev.n, 1);
  assert.strictEqual(pet.view(t).glass, 1);
  assert.strictEqual(pet.view(t).dry, 0);
});

test('долгое сидение каменеет жабу, уход от компьютера засчитывается как перерыв', () => {
  const pet = createPet(null, { moveEvery: 40, waterEvery: 999, breakAfter: 5 }, T0);
  pet.tick(T0, 0);
  let { t, events } = run(pet, T0, 60);
  assert.ok(events.some((e) => e.type === 'remind' && e.kind === 'move'));
  assert.ok(pet.view(t).stone > 0.3);

  // 8 минут никто не трогает мышь
  let idleStart = t;
  ({ t } = run(pet, t, 8, (now) => (now - idleStart) / 1000));
  assert.strictEqual(pet.view(t).activity, 'away');
  assert.strictEqual(pet.view(t).stone, 0);

  // вернулся
  ({ t, events } = run(pet, t, 1, () => 1));
  const back = events.find((e) => e.type === 'back');
  assert.ok(back);
  assert.strictEqual(pet.view(t).day.breaks, 1);
});

test('простой короче порога не сбрасывает сидение', () => {
  const pet = createPet(null, { moveEvery: 40, breakAfter: 5 }, T0);
  pet.tick(T0, 0);
  let { t } = run(pet, T0, 20);
  const idleStart = t;
  ({ t } = run(pet, t, 3, (now) => (now - idleStart) / 1000));
  assert.ok(pet.view(t).sitMin >= 22);
});

test('нет напоминаний, когда человек отошёл или на паузе', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 10 }, T0);
  pet.tick(T0, 0);
  pet.pause(T0, 60);
  let { t, events } = run(pet, T0, 50);
  assert.strictEqual(events.filter((e) => e.type === 'remind').length, 0);
  ({ t, events } = run(pet, t, 20));
  assert.ok(events.some((e) => e.type === 'resumed'));
  assert.ok(events.some((e) => e.type === 'remind'));
});

test('отложить напоминание', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999, nagEvery: 10 }, T0);
  pet.tick(T0, 0);
  let { t, events } = run(pet, T0, 10);
  assert.strictEqual(events.filter((e) => e.type === 'remind').length, 1);
  pet.snooze('water', t, 30);
  ({ events } = run(pet, t, 25));
  assert.strictEqual(events.filter((e) => e.type === 'remind').length, 0);
});

test('ночной сон компьютера: утреннее приветствие и сброс сидения', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  run(pet, T0, 40);
  const morning = T0 + 40 * MIN + 10 * HOUR;
  const events = pet.tick(morning, 0);
  assert.ok(events.some((e) => e.type === 'morning'));
  assert.strictEqual(pet.view(morning).sitMin, 0);
  assert.ok(pet.view(morning).glass < 0.2);
});

test('состояние сериализуется и восстанавливается', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const { t } = run(pet, T0, 20);
  pet.drink(t);
  const copy = createPet(JSON.parse(JSON.stringify(pet.serialize())), {}, t);
  assert.strictEqual(copy.view(t).day.drinks, 1);
  assert.strictEqual(copy.view(t).sitMin, pet.view(t).sitMin);
});

test('новый день обнуляет статистику', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  pet.drink(T0);
  const next = T0 + 15 * HOUR;
  pet.tick(next, 0);
  assert.strictEqual(pet.view(next).day.drinks, 0);
  assert.strictEqual(pet.state.history.length, 1);
});

// ---- Жизнь и смерть ----

test('пороги экспортируются, смерть включена по умолчанию', () => {
  assert.strictEqual(DEATH_WATER, 3.0);
  assert.strictEqual(DEATH_STONE, 2.4);
  assert.strictEqual(CRITICAL, 0.8);
  assert.strictEqual(DEFAULTS.deathEnabled, true);
  const v = createPet(null, {}, T0).view(T0);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(v.cause, null);
  assert.strictEqual(v.generation, 1);
  assert.strictEqual(v.bornAt, T0);
  assert.deepStrictEqual(v.doom, { water: 0, move: 0 });
  assert.deepStrictEqual(v.critical, { water: false, move: false });
  assert.strictEqual(v.graveyardCount, 0);
  assert.strictEqual(v.totals.days, 1);
});

test('смерть от жажды ровно на пороге DEATH_WATER', () => {
  // сидение не мешает: разминка каждые 30 мин
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let { t, events } = run(pet, T0, 29);
  assert.ok(!events.some((e) => e.type === 'death'));
  assert.strictEqual(pet.view(t).life, 'alive');
  ({ t, events } = run(pet, t, 1));
  const death = events.find((e) => e.type === 'death');
  assert.ok(death);
  assert.strictEqual(death.cause, 'dry');
  assert.strictEqual(death.generation, 1);
  assert.strictEqual(death.ageMin, 30);
  assert.ok(death.text.length > 0);
  const v = pet.view(t);
  assert.strictEqual(v.life, 'dead');
  assert.strictEqual(v.cause, 'dry');
  assert.strictEqual(v.diedAt, t);
  assert.strictEqual(v.doom.water, 1);
  assert.strictEqual(v.totals.deaths, 1);
  assert.strictEqual(v.totals.deathsDry, 1);
  assert.strictEqual(v.totals.longestLifeMin, 30);
  assert.strictEqual(v.graveyardCount, 1);
});

test('смерть от окаменения на пороге DEATH_STONE', () => {
  const pet = createPet(null, { waterEvery: 999, moveEvery: 10 }, T0);
  pet.tick(T0, 0);
  let { t, events } = run(pet, T0, 23);
  assert.ok(!events.some((e) => e.type === 'death'));
  ({ t, events } = run(pet, t, 1));
  const death = events.find((e) => e.type === 'death');
  assert.ok(death);
  assert.strictEqual(death.cause, 'stone');
  const v = pet.view(t);
  assert.strictEqual(v.totals.deathsStone, 1);
  assert.strictEqual(v.totals.maxSitMs, 24 * MIN);
});

test('critical приходит один раз и снова — только после выхода из зоны', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let { t, events } = run(pet, T0, 28);
  let crit = events.filter((e) => e.type === 'critical');
  assert.strictEqual(crit.length, 1);
  assert.strictEqual(crit[0].kind, 'water');
  assert.ok(crit[0].text.length > 0);
  assert.strictEqual(pet.view(t).critical.water, true);
  pet.drink(t);
  assert.strictEqual(pet.view(t).critical.water, false);
  ({ t, events } = run(pet, t, 25));
  assert.strictEqual(events.filter((e) => e.type === 'critical').length, 1);
});

test('deathEnabled=false: не умирает и нет critical, но напоминает', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 10, deathEnabled: false }, T0);
  pet.tick(T0, 0);
  const { t, events } = run(pet, T0, 120);
  assert.ok(!events.some((e) => e.type === 'death' || e.type === 'critical'));
  assert.ok(events.some((e) => e.type === 'remind'));
  const v = pet.view(t);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(v.doom.water, 1);
  assert.deepStrictEqual(v.critical, { water: false, move: false });
});

test('мёртвую не напоминают, время не тикает, drink/stretch только в статистику', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let { t } = run(pet, T0, 30);
  assert.strictEqual(pet.view(t).life, 'dead');
  const before = pet.view(t).waterRatio;
  let events;
  ({ t, events } = run(pet, t, 60));
  assert.strictEqual(events.length, 0);
  assert.strictEqual(pet.view(t).waterRatio, before);
  const d = pet.drink(t);
  const s = pet.stretch(t);
  assert.strictEqual(d.n, 1);
  assert.strictEqual(s.n, 1);
  const v = pet.view(t);
  assert.strictEqual(v.life, 'dead');
  assert.strictEqual(v.waterRatio, before);
  assert.strictEqual(v.totals.drinks, 1);
  assert.strictEqual(v.totals.breaks, 1);
  assert.strictEqual(v.needs.water, false);
  assert.strictEqual(v.ageMin, 30);
});

test('revive: новое поколение, счётчики сброшены, кладбище заполнено', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let { t } = run(pet, T0, 30);
  t += 5 * MIN;
  const ev = pet.revive(t);
  assert.strictEqual(ev.type, 'reborn');
  assert.strictEqual(ev.generation, 2);
  assert.ok(ev.text.length > 0);
  const v = pet.view(t);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(v.cause, null);
  assert.strictEqual(v.diedAt, 0);
  assert.strictEqual(v.generation, 2);
  assert.strictEqual(v.bornAt, t);
  assert.strictEqual(v.ageMin, 0);
  assert.strictEqual(v.glass, 1);
  assert.strictEqual(v.sitMin, 0);
  assert.deepStrictEqual(pet.graveyard(), [{ generation: 1, cause: 'dry', bornAt: T0, diedAt: T0 + 30 * MIN, ageMin: 30 }]);
  // новая жаба снова живёт и может умереть
  const r = run(pet, t, 30);
  assert.ok(r.events.some((e) => e.type === 'death' && e.generation === 2));
  assert.strictEqual(pet.view(r.t).totals.deaths, 2);
});

test('кладбище хранит последние 50 жаб', () => {
  const pet = createPet(null, { waterEvery: 1, moveEvery: 999 }, T0);
  let t = T0;
  pet.tick(t, 0);
  for (let i = 0; i < 55; i++) {
    ({ t } = run(pet, t, 3));
    pet.revive(t);
  }
  const g = pet.graveyard();
  assert.strictEqual(g.length, 50);
  assert.strictEqual(g[0].generation, 6);
  assert.strictEqual(pet.view(t).totals.deaths, 55);
});

test('утро возрождает мёртвую жабу: сначала reborn, потом morning', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  const { t } = run(pet, T0, 30);
  assert.strictEqual(pet.view(t).life, 'dead');
  const morning = t + 22 * HOUR; // 8:30 следующего дня
  const events = pet.tick(morning, 0);
  assert.deepStrictEqual(events.map((e) => e.type), ['reborn', 'morning']);
  const v = pet.view(morning);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(v.generation, 2);
  assert.strictEqual(v.totals.days, 2);
});

test('отошёл от компьютера — не умирает в одиночестве', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999, breakAfter: 5 }, T0);
  pet.tick(T0, 0);
  const idleStart = T0;
  const { events } = run(pet, T0, 60, (now) => (now - idleStart) / 1000);
  assert.ok(!events.some((e) => e.type === 'death'));
});

test('сериализация новых полей и совместимость со старым состоянием', () => {
  const pet = createPet(null, { waterEvery: 10, moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let { t } = run(pet, T0, 30);
  const copy = createPet(JSON.parse(JSON.stringify(pet.serialize())), { waterEvery: 10 }, t + MIN);
  const v = copy.view(t);
  assert.strictEqual(v.life, 'dead');
  assert.strictEqual(v.cause, 'dry');
  assert.strictEqual(v.generation, 1);
  assert.strictEqual(v.graveyardCount, 1);
  assert.strictEqual(v.totals.deathsDry, 1);
  assert.strictEqual(copy.revive(t).generation, 2);

  // старое сохранение без новых полей
  const old = {
    waterMs: 5 * MIN, sitMs: 0, lastTick: T0,
    day: { date: '2026-10-19', drinks: 2, breaks: 1, autoBreaks: 0, maxSitMs: 0, codingMs: 0 },
    history: [{ date: '2026-10-18', drinks: 5, breaks: 3, autoBreaks: 2, maxSitMs: 40 * MIN, codingMs: HOUR }],
  };
  const o = createPet(old, {}, T0);
  const ov = o.view(T0);
  assert.strictEqual(ov.life, 'alive');
  assert.strictEqual(ov.generation, 1);
  assert.strictEqual(ov.bornAt, T0);
  assert.strictEqual(ov.graveyardCount, 0);
  assert.strictEqual(ov.totals.drinks, 7);
  assert.strictEqual(ov.totals.breaks, 4);
  assert.strictEqual(ov.totals.days, 2);
  assert.strictEqual(ov.totals.maxSitMs, 40 * MIN);
  assert.strictEqual(ov.totals.deaths, 0);
  o.drink(T0);
  assert.strictEqual(o.view(T0).totals.drinks, 8);
});
