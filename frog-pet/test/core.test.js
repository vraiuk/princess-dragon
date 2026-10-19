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
    // 3-я минута: ratio 3 перепрыгивает зону critical — сначала предупреждение, смерть на 4-й (r1-06-03)
    ({ t } = run(pet, t, 4));
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

// ---- Реальный день пользователя (T2) ----

// Сценарий дня: тики каждые 10 с, как часы в main (там раз в секунду)
function life(pet, t) {
  const L = { t, events: [] };
  const tick = (idle) => { L.events.push(...pet.tick(L.t, idle)); };
  // работает: мышь/клавиатура трогаются постоянно
  L.work = (min) => { for (let i = 0; i < min * 6; i++) { L.t += 10000; tick(1); } return L; };
  // не трогает мышь min минут (читает, ушёл), потом возвращается
  L.idle = (min) => {
    const from = L.t;
    for (let i = 0; i < min * 6; i++) { L.t += 10000; tick((L.t - from) / 1000); }
    L.t += 1000; tick(0);
    return L;
  };
  // ноутбук спит / крышка закрыта: тиков нет вообще
  L.sleep = (min) => { L.t += min * MIN; tick(0); return L; };
  L.drink = () => { L.events.push(pet.drink(L.t)); return L; };
  L.of = (type) => L.events.filter((e) => e.type === type);
  return L;
}

test('обычный день 9–19: обед, созвоны на паузе, чтение без мыши — ни смертей, ни critical', () => {
  const T9 = new Date(2026, 9, 19, 9, 0, 0).getTime();
  const pet = createPet(null, {}, T9);
  pet.tick(T9, 0);
  const L = life(pet, T9).drink();
  L.work(40).idle(4).work(20).drink();             // 4 мин читает доку — не перерыв
  assert.strictEqual(L.of('back').length, 0, 'чтение 4 мин без мыши не засчитано как перерыв');
  L.idle(6).work(30);                               // отошёл на 6 мин — перерыв
  assert.strictEqual(L.of('back').length, 1);
  pet.pause(L.t, 60); L.work(60);                   // созвон на паузе
  L.drink().work(30).idle(60).drink().work(45);     // обед 60 мин
  L.sleep(20).work(40).drink().idle(7).work(50).drink().work(30);  // крышка закрыта 20 мин
  const v = pet.view(L.t);
  assert.strictEqual(v.life, 'alive');
  assert.strictEqual(L.of('death').length, 0);
  assert.strictEqual(L.of('critical').length, 0);
  assert.strictEqual(v.day.drinks, 6);
  assert.strictEqual(pet.state.day.autoBreaks, 4, '6 мин, обед, крышка, 7 мин');
  assert.ok(v.day.maxSit < 120);
});

test('вернулся с обеда, не попив до него: жаба при смерти, но не умирает мгновенно', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).drink().work(90);        // 90 мин без воды (ratio 2.0, ещё не critical)
  assert.strictEqual(L.of('critical').length, 0);
  L.idle(60);                                       // обед: за это время дошёл бы до 3.33
  assert.strictEqual(L.of('death').length, 0, 'не умерла при возвращении');
  assert.strictEqual(pet.view(L.t).life, 'alive');
  assert.strictEqual(L.of('critical').length, 1, 'сначала предупреждение');
  L.work(20);
  assert.strictEqual(pet.view(L.t).life, 'alive', 'есть время дойти до кулера');
  L.work(10);
  assert.strictEqual(L.of('death').length, 1, 'игнор после возвращения всё же убивает');
});

test('ночь после critical: утром жаба не умирает через пару минут', () => {
  const pet = createPet(null, { moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).drink().work(125);        // вечером довёл до 2.78 — critical
  assert.strictEqual(L.of('critical').length, 1);
  L.sleep(14 * 60);                                 // ноутбук закрыт на ночь
  assert.ok(L.of('morning').length === 1);
  L.work(30);
  assert.strictEqual(L.of('death').length, 0);
  assert.ok(pet.view(L.t).waterRatio < 2, 'утро — почти пустой стакан, а не вчерашняя засуха');
});

test('крышка закрыта 3 часа в critical: снова предупреждение, а не смерть сразу', () => {
  const pet = createPet(null, { moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).drink().work(130);
  L.sleep(3 * 60);
  const before = L.of('critical').length;
  L.work(1);
  assert.strictEqual(L.of('death').length, 0);
  assert.strictEqual(L.of('critical').length, before + 1);
  L.work(15);
  assert.strictEqual(pet.view(L.t).life, 'alive');
});

test('уменьшили waterEvery/moveEvery на лету — жаба не умирает в следующий тик', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).work(40);
  const before = pet.view(L.t);
  pet.setSettings(Object.assign({}, DEFAULTS, { waterEvery: 10, moveEvery: 10 }));
  L.work(1);
  const v = pet.view(L.t);
  assert.strictEqual(L.of('death').length, 0);
  assert.strictEqual(v.life, 'alive');
  assert.ok(v.waterRatio < before.waterRatio + 0.2, 'доля пути не скачет');
  assert.ok(v.sitRatio < before.sitRatio + 0.2);
  assert.ok(pet.view(L.t).totals.maxSitMs >= 40 * MIN, 'рекорд сидения не усох');
  // увеличение интервала ничего не пересчитывает
  pet.setSettings(Object.assign({}, DEFAULTS, { waterEvery: 60 }));
  assert.strictEqual(pet.state.waterMs, pet.serialize().waterMs);
});

test('включили хардкор, когда жаба давно «за гранью»: сначала critical, потом смерть', () => {
  const pet = createPet(null, { deathEnabled: false }, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).work(4 * 60);
  assert.strictEqual(pet.view(L.t).life, 'alive');
  pet.setSettings(Object.assign({}, DEFAULTS, { deathEnabled: true }));
  L.work(1);
  assert.strictEqual(L.of('death').length, 0, 'не умирает мгновенно');
  assert.deepStrictEqual(L.of('critical').map((e) => e.kind).sort(), ['move', 'water']);
  L.work(30);
  assert.strictEqual(L.of('death').length, 1, 'игнор после предупреждения убивает');
});

test('пауза поверх critical: не умирает и не ноет, после паузы — как было', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).drink().work(115);
  assert.strictEqual(L.of('critical').length, 2);
  const ratio = pet.view(L.t).waterRatio;
  pet.pause(L.t, 120);
  const n = L.events.length;
  L.work(119);
  assert.deepStrictEqual(L.events.slice(n), [], 'на паузе тишина');
  assert.strictEqual(pet.view(L.t).waterRatio, ratio);
  L.work(2);
  assert.strictEqual(L.events[n].type, 'resumed');
  assert.ok(L.events.slice(n).some((e) => e.type === 'remind'), 'после паузы снова напоминает');
  assert.strictEqual(pet.view(L.t).life, 'alive');
});

test('перевод часов назад / перелёт на запад через полночь не плодит дни', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const d2 = new Date(2026, 9, 20, 0, 5).getTime();
  pet.tick(d2, 1);
  pet.drink(d2);
  const back = new Date(2026, 9, 19, 23, 50).getTime(); // часы ушли назад на 15 мин
  pet.tick(back, 1);
  pet.drink(back);
  pet.tick(d2 + MIN, 1);
  const st = pet.serialize();
  assert.deepStrictEqual(st.history.map((d) => d.date), ['2026-10-19']);
  assert.strictEqual(st.day.date, '2026-10-20');
  assert.strictEqual(st.day.drinks, 2);
  assert.strictEqual(st.totals.days, 2);
});

test('полночь во время работы: долгий заход попадает в рекорд вчерашнего дня', () => {
  const t = new Date(2026, 9, 19, 23, 0).getTime();
  const pet = createPet(null, { moveEvery: 999, waterEvery: 999 }, t);
  pet.tick(t, 0);
  const L = life(pet, t).work(90);
  assert.strictEqual(pet.state.history.length, 1);
  assert.ok(pet.state.history[0].maxSitMs >= 59 * MIN);
  assert.ok(pet.view(L.t).day.maxSit >= 90, 'сегодняшний заход тоже виден');
});

test('выходные и неделя простоя: утро, дни считаются один раз, история ограничена', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  let L = life(pet, T0).drink().work(60);
  L.sleep(2 * 24 * 60 + 60);                        // выходные без запуска
  assert.strictEqual(L.of('morning').length, 1);
  L.work(60).sleep(7 * 24 * 60);                    // неделя простоя
  assert.strictEqual(L.of('morning').length, 2);
  assert.strictEqual(L.of('death').length, 0);
  for (let i = 0; i < 40; i++) L.work(30).sleep(24 * 60 - 30);
  const st = pet.serialize();
  assert.strictEqual(st.totals.days, 43);
  assert.strictEqual(st.history.length, 30);
  assert.strictEqual(new Set(st.history.map((d) => d.date)).size, 30);
  assert.strictEqual(st.totals.drinks, 1);
});

// ---------- круг 2 (F1): регрессии по находкам r1 ----------
const Core = require('../app/core');

// жаба работает до смерти (тики по 20 с)
function untilDead(pet, t) {
  for (let i = 0; i < 5000 && pet.view(t).life === 'alive'; i++) { t += 20 * 1000; pet.tick(t, 1); }
  return t;
}

test('r1-06-01: разовый тик с часами в прошлом не превращается в «ночь»', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const real = untilDead(pet, T0);
  assert.strictEqual(pet.view(real).life, 'dead');
  pet.tick(real - 7 * HOUR, 1);                  // часы скакнули назад на один тик
  const ev = pet.tick(real + 20 * 1000, 1);      // реально прошло 20 секунд
  assert.deepStrictEqual(ev.map((e) => e.type), []);
  assert.strictEqual(pet.view(real + 20 * 1000).life, 'dead');

  // живая жаба при смерти: скачок назад-вперёд её не «лечит»
  const p2 = createPet(null, {}, T0);
  p2.tick(T0, 0);
  const L = life(p2, T0).work(110);
  const wr = p2.view(L.t).waterRatio;
  p2.tick(L.t - 7 * HOUR, 1);
  p2.tick(L.t + 10 * 1000, 1);
  assert.ok(p2.view(L.t).waterRatio >= wr, 'стакан не наполнился сам');
});

test('r1-06-01: часы переведены назад насовсем — жаба продолжает жить по новым часам', () => {
  const pet = createPet(null, { moveEvery: 999 }, T0);
  pet.tick(T0, 0);
  let t = T0 + 30 * MIN;
  pet.tick(t, 1);
  t -= 3 * HOUR;                                  // часы спешили на 3 ч, NTP их поправил
  for (let i = 0; i < 20 * 6; i++) { t += 10000; pet.tick(t, 1); }
  assert.ok(pet.view(t).waterRatio > 50 / 45 - 0.01, 'вода продолжает убывать: ' + pet.view(t).waterRatio);
});

test('r1-06-02: tick(NaN)/tick(Infinity) игнорируются и не портят день и стакан', () => {
  let t = T0;
  const pet = createPet(null, {}, t);
  pet.tick(t, 0);
  assert.deepStrictEqual(pet.tick(NaN, 0), []);
  assert.deepStrictEqual(pet.tick(Infinity, 0), []);
  assert.deepStrictEqual(pet.tick(undefined, 0), []);
  t += MIN; pet.tick(t, 0);
  t += 24 * HOUR; pet.tick(t, 0);
  const s = pet.serialize();
  assert.strictEqual(s.day.date, Core.dayKey(t));
  assert.ok(Number.isFinite(s.waterMs) && Number.isFinite(s.lastTick));
});

test('r1-06-03: тик перепрыгнул зону «при смерти» — сначала critical, смерть только следующим тиком', () => {
  let t = T0;
  const pet = createPet(null, { waterEvery: 3, moveEvery: 1000 }, t);
  pet.tick(t, 0);
  const ev = [];
  for (let i = 0; i < 4 && pet.view(t).life === 'alive'; i++) { t += 4.5 * MIN; ev.push(...pet.tick(t, 0)); }
  const types = ev.filter((e) => e.type === 'critical' || e.type === 'death').map((e) => e.type);
  assert.deepStrictEqual(types, ['critical', 'death']);
});

test('r1-06-03: мусорные интервалы (0, NaN, отрицательные) заменяются значениями по умолчанию', () => {
  for (const bad of [0, NaN, -5, 'x', null, Infinity]) {
    const pet = createPet(null, { waterEvery: bad, moveEvery: bad, breakAfter: bad, nagEvery: bad }, T0);
    pet.tick(T0, 0);
    const L = life(pet, T0).work(10);
    const v = pet.view(L.t);
    assert.strictEqual(v.life, 'alive', 'waterEvery=' + bad);
    assert.ok(Number.isFinite(v.glass) && v.glass > 0.7, 'glass=' + v.glass);
    pet.setSettings({ waterEvery: bad });
    assert.ok(Number.isFinite(pet.view(L.t).glass));
  }
});

test('r1-06-04: мёртвой жабе не говорят «камень осыпался» и «я снова на посту»', () => {
  const pet = createPet(null, {}, T0, () => 0);
  pet.tick(T0, 0);
  const L = life(pet, T0).drink();
  L.work(200);
  assert.strictEqual(pet.view(L.t).cause, 'stone');
  L.idle(10);
  const back = L.of('back');
  assert.strictEqual(back.length, 1, 'перерыв засчитан в статистику');
  assert.ok(!/осыпался|без стула/.test(back[0].text), back[0].text);
  pet.pause(L.t, 1);
  L.work(2);
  const res = L.of('resumed');
  assert.strictEqual(res.length, 1);
  assert.ok(!/на посту/.test(res[0].text), res[0].text);
  assert.ok(!/на посту/.test(pet.pause(L.t, 0).text));
  assert.strictEqual(pet.view(L.t).sitMin, 120, 'камень не осыпался');
});

test('r1-02-04: без ответа напоминания приходят не чаще раза в nagEvery', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const at = [];
  let t = T0;
  for (let i = 1; i <= 150 && pet.view(t).life === 'alive'; i++) {
    t += MIN;
    if (pet.tick(t, 1).some((e) => e.type === 'remind')) at.push(i);
  }
  // первые напоминания о воде (45) и о движении (50) — как обещано, дальше общий повтор раз в 10 мин
  assert.deepStrictEqual(at.slice(0, 2), [45, 50]);
  for (let i = 2; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 10, 'напоминания: ' + at.join(','));
});

test('r1-02-04: «Позже» не отменяется напоминанием о другом таймере', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).work(46);              // вода просит
  pet.snooze('water', L.t, 30);
  const n = L.events.length;
  L.work(20);                                     // разминка просит на 50-й
  const water = L.events.slice(n).filter((e) => e.type === 'remind' && e.kind === 'water');
  assert.deepStrictEqual(water, [], 'вода отложена на 30 мин');
});

test('r1-02-08: после сна 2–6 ч жаба сразу просит воды', () => {
  const pet = createPet(null, {}, T0);
  pet.tick(T0, 0);
  const L = life(pet, T0).work(20).sleep(3 * 60).work(1);
  assert.ok(L.events.some((e) => e.type === 'remind' && e.kind === 'water'));
  assert.strictEqual(L.of('death').length + L.of('critical').length, 0);
});

test('r1-05-01: одна и та же реплика не выпадает дважды подряд; poke без дублей', () => {
  const pet = createPet(null, {}, T0);
  for (let i = 0; i < 200; i++) {
    const a = pet.poke().text, b = pet.poke().text;
    assert.notStrictEqual(a, b);
  }
  const say = Core.say;
  let prev = null;
  const last = {};
  for (let i = 0; i < 200; i++) { const s = say('waterBad', {}, null, last); assert.notStrictEqual(s, prev); prev = s; }
  assert.strictEqual(new Set(Core.PHRASES.poke).size, Core.PHRASES.poke.length);
});

test('r1-05-05: длительности в репликах — часами и днями, а не сотнями минут', () => {
  const f = Core.fmtDur;
  assert.strictEqual(f(0), '0 мин');
  assert.strictEqual(f(45), '45 мин');
  assert.strictEqual(f(60), '1 ч');
  assert.strictEqual(f(110), '1 ч 50 мин');
  assert.strictEqual(f(1440), '1 день');
  assert.strictEqual(f(2950), '2 дня 1 ч');
  assert.strictEqual(f(5 * 1440 + 30), '5 дней');
  const pet = createPet(null, {}, T0);
  assert.strictEqual(pet.pause(T0, 240).text, 'Ок, не мешаю. Пауза на 4 ч 🤫');
  for (const s of Object.values(Core.PHRASES).flat()) assert.ok(!/\{\w+\} мин/.test(s), 'минуты в фразе: ' + s);
});

test('r1-05-06/08/11/16: фразы смерти влезают в облачко надгробия, тексты без «...» и «сидели»', () => {
  for (const k of ['death_dry', 'death_stone']) {
    for (const s of Core.PHRASES[k]) {
      const t = s.replace(/\{gen\}/g, '999').replace(/\{age\}/g, '2 дня 23 ч');
      assert.ok(t.length <= 64, t.length + ': ' + t);
    }
  }
  for (const s of Object.values(Core.PHRASES).flat()) {
    assert.ok(!/\.\.\./.test(s), 'многоточие тремя точками: ' + s);
    assert.ok(!/сидели|погашен ею|и я stack trace/.test(s), s);
  }
});

test('r1-04-08: свой генератор случайных чисел — реплики воспроизводимы', () => {
  const runOnce = () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pet = createPet(null, {}, T0, rnd);
    pet.tick(T0, 0);
    const L = life(pet, T0).work(130);
    return L.events.map((e) => e.text + (e.tip || '')).join('|') + pet.poke().text;
  };
  assert.strictEqual(runOnce(), runOnce());
});
