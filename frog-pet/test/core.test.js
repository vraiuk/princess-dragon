'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPet, MIN, HOUR } = require('../app/core');

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
