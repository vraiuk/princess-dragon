'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core');
const FrogAchievements = require('../app/achievements');
const { createAchievements, DEFS } = FrogAchievements;
const { MIN, HOUR } = Core;

const T0 = new Date(2026, 9, 19, 10, 0, 0).getTime();

// Прокручивает время по минуте, после каждого тика зовёт A.check
function run(pet, A, from, minutes, idle = () => 1) {
  const got = [];
  let t = from;
  for (let i = 0; i < minutes; i++) {
    t += MIN;
    const events = pet.tick(t, idle(t));
    got.push(...A.check({ now: t, events, view: pet.view(t), state: pet.serialize(), settings: {} }));
  }
  return { t, got };
}

// Действие (drink/stretch/poke...) + check
function act(pet, A, t, ev) {
  return A.check({ now: t, events: [ev], view: pet.view(t), state: pet.serialize(), settings: {} });
}

const ids = (arr) => arr.map((a) => a.id);

test('DEFS: 30–40 ачивок, уникальные id, обязательные на месте', () => {
  assert.ok(DEFS.length >= 30 && DEFS.length <= 40, 'всего ' + DEFS.length);
  assert.strictEqual(new Set(DEFS.map((d) => d.id)).size, DEFS.length);
  for (const d of DEFS) {
    assert.ok(['good', 'bad', 'secret'].includes(d.kind), d.id);
    assert.ok(['common', 'rare', 'epic', 'legendary'].includes(d.rarity), d.id);
    assert.ok(d.title && d.desc && d.icon, d.id);
  }
  const titles = DEFS.map((d) => d.title);
  for (const t of ['Железножопая жаба', 'Нефритовая жаба', 'Изюм']) assert.ok(titles.includes(t), t);
});

test('первый стакан и «Гидратированный разработчик» выдаются один раз', () => {
  const pet = Core.createPet(null, { waterEvery: 999, moveEvery: 999 }, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  let t = T0;
  const got = [];
  for (let i = 0; i < 8; i++) {
    t += 20 * MIN;
    pet.tick(t, 1);
    got.push(...act(pet, A, t, pet.drink(t)));
  }
  assert.strictEqual(ids(got).filter((x) => x === 'first_drink').length, 1);
  assert.ok(ids(got).includes('hydrated'));
  // ещё стаканы — повторно ничего не выдаётся
  t += 20 * MIN;
  const again = act(pet, A, t, pet.drink(t));
  assert.ok(!ids(again).includes('hydrated') && !ids(again).includes('first_drink'));
  const h = A.list().find((a) => a.id === 'hydrated');
  assert.deepStrictEqual(h.progress, { cur: 8, max: 8 });
  assert.ok(h.unlocked && h.at > 0);
});

test('«Железножопая жаба» за 2 часа без перерыва', () => {
  const pet = Core.createPet(null, { waterEvery: 999, moveEvery: 999, deathEnabled: false }, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  let { t, got } = run(pet, A, T0, 100);
  assert.ok(!ids(got).includes('iron_butt'));
  ({ t, got } = run(pet, A, t, 25));
  assert.deepStrictEqual(ids(got).filter((x) => x === 'iron_butt'), ['iron_butt']);
  ({ got } = run(pet, A, t, 10));
  assert.ok(!ids(got).includes('iron_butt'));
});

test('«Ночная жаба»: кодинг в 2:30 ночи', () => {
  const night = new Date(2026, 9, 20, 2, 0, 0).getTime();
  const pet = Core.createPet(null, { waterEvery: 999, moveEvery: 999 }, night);
  const A = createAchievements(null);
  pet.tick(night, 0);
  const { got } = run(pet, A, night, 30);
  assert.ok(ids(got).includes('night'));
});

test('«Изюм», «Нефритовая жаба», «Мумия фараона», «Тамагочи-убийца» (синтетический ctx)', () => {
  const A = createAchievements(null);
  let t = T0;
  const die = (cause) => {
    t += 3 * 60 * MIN;
    return ids(A.check({ now: t, events: [{ type: 'death', cause, generation: 1, ageMin: 500 }], view: { life: 'dead' }, state: {} }));
  };
  const first = die('dry');
  assert.ok(first.includes('raisin') && !first.includes('jade'));
  const second = die('stone');
  assert.ok(second.includes('jade') && second.includes('combo'));
  assert.ok(!die('dry').includes('mummy'));
  assert.ok(die('dry').includes('mummy'));
  assert.ok(die('stone').includes('tamagotchi'));
  // «Феникс» и Ctrl+Z при быстром воскрешении
  t += 30 * 1000;
  const reb = ids(A.check({ now: t, events: [{ type: 'reborn', generation: 6 }], view: { life: 'alive', generation: 6 }, state: {} }));
  assert.ok(reb.includes('phoenix') && reb.includes('ctrl_z'));
  const tm = A.list().find((a) => a.id === 'tamagotchi');
  assert.deepStrictEqual(tm.progress, { cur: 5, max: 5 });
});

test('реальная смерть от засухи в core даёт «Изюм»', { skip: typeof Core.createPet(null, {}, T0).revive !== 'function' }, () => {
  const pet = Core.createPet(null, { waterEvery: 30, moveEvery: 999 }, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  const { got } = run(pet, A, T0, 200);
  assert.ok(ids(got).includes('raisin'));
  assert.ok(ids(got).includes('vobla'));
});

test('секретные скрыты до получения: «Работает — не трогай» за 50 тычков', () => {
  const pet = Core.createPet(null, {}, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  const secret = A.list().find((a) => a.id === 'poke50');
  assert.strictEqual(secret.hidden, true);
  assert.strictEqual(secret.title, '???');
  assert.strictEqual(secret.progress, null);
  assert.ok(!JSON.stringify(secret).includes('Работает'));
  let t = T0, got = [];
  for (let i = 0; i < 50; i++) {
    t += 30 * 1000; // по тычку в 30 с — без DDoS
    got.push(...act(pet, A, t, pet.poke()));
  }
  assert.ok(ids(got).includes('poke50'));
  assert.ok(!ids(got).includes('ddos'));
  const open = A.list().find((a) => a.id === 'poke50');
  assert.strictEqual(open.hidden, false);
  assert.strictEqual(open.title, 'Работает — не трогай');
});

test('«Водохлёб»: 3 стакана за 5 минут; «Snooze-инженер»; перетаскивания', () => {
  const pet = Core.createPet(null, {}, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  let got = [];
  for (let i = 1; i <= 3; i++) got.push(...act(pet, A, T0 + i * MIN, pet.drink(T0 + i * MIN)));
  assert.ok(ids(got).includes('vodohleb'));
  got = [];
  for (let i = 0; i < 10; i++) got.push(...act(pet, A, T0 + 10 * MIN, { type: 'snooze', kind: 'water' }));
  assert.deepStrictEqual(ids(got), ['snooze10']);
  got = act(pet, A, T0 + 11 * MIN, { type: 'dragged' });
  assert.deepStrictEqual(ids(got), ['drag1']);
});

test('серия хороших дней из истории и Zero downtime', () => {
  const A = createAchievements(null);
  const history = [];
  for (let i = 7; i >= 1; i--) {
    const d = new Date(2026, 9, 19 - i);
    history.push({ date: Core.dayKey(d.getTime()), drinks: 7, breaks: 3, autoBreaks: 2, maxSitMs: 0, codingMs: 0 });
  }
  const state = { history, day: { date: Core.dayKey(T0), drinks: 0, breaks: 0, autoBreaks: 0 } };
  const got = ids(A.check({ now: T0, events: [], view: {}, state }));
  assert.ok(got.includes('streak3') && got.includes('streak7') && got.includes('zero_downtime'));
});

test('сериализация: ачивки и счётчики переживают перезапуск', () => {
  const A = createAchievements(null);
  for (let i = 0; i < 7; i++) A.check({ now: T0 + i * MIN, events: [{ type: 'dragged' }], view: {}, state: {} });
  A.check({ now: T0, events: [{ type: 'drink' }], view: {}, state: {} });
  const saved = JSON.parse(JSON.stringify(A.serialize()));
  const B = createAchievements(saved);
  assert.deepStrictEqual(B.list(), A.list());
  // полученное повторно не выдаётся, счётчик продолжает расти
  assert.deepStrictEqual(ids(B.check({ now: T0 + HOUR, events: [{ type: 'drink' }], view: {}, state: {} })), []);
  let got = [];
  for (let i = 0; i < 3; i++) got.push(...B.check({ now: T0 + 2 * HOUR, events: [{ type: 'dragged' }], view: {}, state: {} }));
  assert.deepStrictEqual(ids(got), ['drag10']);
  // мусор вместо сохранения не ломает
  assert.strictEqual(createAchievements('мусор').list().length, DEFS.length);
});

