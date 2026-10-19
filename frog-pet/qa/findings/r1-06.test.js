'use strict';
// R1-06: падающие тесты-доказательства. Каждый падает на текущем коде и должен проходить после фикса.
//   node --test qa/findings/r1-06.test.js
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../../app/core');
const Ach = require('../../app/achievements');
const { MIN, HOUR } = Core;

const T0 = new Date(2026, 9, 14, 12, 0, 0).getTime(); // среда, 12:00 локального времени

function harness(settings, t0) {
  const h = { t: t0, pet: Core.createPet(null, settings || {}, t0), A: Ach.createAchievements(null), got: [], events: [] };
  h.check = (events) => {
    h.events.push(...events);
    h.got.push(...h.A.check({ now: h.t, events, view: h.pet.view(h.t), state: h.pet.serialize(), settings: {} }).map((a) => a.id));
  };
  h.tick = (dt, idle = 1) => { h.t += dt; h.check(h.pet.tick(h.t, idle)); };
  h.act = (name) => { h.check([h.pet[name](h.t)]); };
  h.untilDead = () => { let i = 0; while (h.pet.view(h.t).life === 'alive' && i++ < 5000) h.tick(20 * 1000); };
  h.check(h.pet.tick(h.t, 0));
  return h;
}

test('r1-06-01: один тик с t в прошлом не должен превращаться в «ночь» и воскрешать жабу', () => {
  const h = harness({}, T0);
  h.untilDead();
  assert.strictEqual(h.pet.view(h.t).life, 'dead');
  const real = h.t;
  h.pet.tick(real - 7 * HOUR, 1);       // разовый скачок часов назад (NTP/ручная правка)
  const ev = h.pet.tick(real + 20 * 1000, 1); // реально прошло 20 секунд
  assert.deepStrictEqual(ev.map((e) => e.type), [], 'за 20 реальных секунд не должно быть ни reborn, ни morning');
  assert.strictEqual(h.pet.view(real + 20 * 1000).life, 'dead');
});

test('r1-06-02: tick(NaN) не должен навсегда ломать смену дня и счётчик воды', () => {
  let t = T0;
  const pet = Core.createPet(null, {}, t);
  pet.tick(t, 0);
  pet.tick(NaN, 0);
  t += MIN; pet.tick(t, 0);
  t += 24 * HOUR; pet.tick(t, 0);
  const s = pet.serialize();
  assert.strictEqual(s.day.date, Core.dayKey(t), 'день должен смениться на настоящую дату');
  assert.ok(Number.isFinite(s.waterMs), 'waterMs=' + s.waterMs);
});

test('r1-06-03: смерть не должна наступать без critical, даже если тик перепрыгнул зону «при смерти»', () => {
  // waterEvery=3 проходит cleanSettings (любое положительное число из frog.json);
  // зона critical для воды 7.2–9 мин, тик через 4.5 мин < breakAfter (человек не «ушёл»)
  let t = T0;
  const pet = Core.createPet(null, { waterEvery: 3, moveEvery: 1000 }, t);
  pet.tick(t, 0);
  const ev = [];
  for (let i = 0; i < 4 && pet.view(t).life === 'alive'; i++) { t += 4.5 * MIN; ev.push(...pet.tick(t, 0)); }
  const types = ev.filter((e) => e.type === 'critical' || e.type === 'death').map((e) => e.type);
  assert.ok(types.indexOf('death') < 0 || types.indexOf('critical') >= 0 && types.indexOf('critical') < types.indexOf('death'),
    'события: ' + types.join(','));
});

test('r1-06-04: мёртвой жабе не говорят «камень осыпался» и «я снова на посту»', () => {
  const rnd = Math.random;
  Math.random = () => 0; // первая фраза из списка
  try {
    const h = harness({}, T0);
    h.untilDead(); // окаменела: sitMin=120
    const bad = [];
    for (let i = 0; i < 30; i++) h.tick(20 * 1000, 600); // ушёл на 10 мин
    h.tick(20 * 1000, 0);                                  // вернулся
    h.pet.pause(h.t, 1);
    h.tick(2 * MIN, 0);                                    // пауза кончилась
    for (const e of h.events) {
      if (e.type === 'back' && /камень осыпался/.test(e.text)) bad.push(e.text);
      if (e.type === 'resumed' && /на посту/.test(e.text)) bad.push(e.text);
    }
    assert.strictEqual(h.pet.view(h.t).life, 'dead');
    assert.deepStrictEqual(bad, []);
  } finally { Math.random = rnd; }
});

test('r1-06-05: прогресс дневной ачивки показывает сегодняшний факт, а не рекорд прошлых дней', () => {
  const h = harness({}, T0);
  for (let i = 0; i < 5; i++) { h.act('drink'); h.t += MIN; }
  h.tick(14 * HOUR, 0); // ночь, новый день
  assert.strictEqual(h.pet.view(h.t).day.drinks, 0);
  const pr = h.A.list().find((a) => a.id === 'hydrated').progress;
  assert.deepStrictEqual(pr, { cur: 0, max: 8 }, '«8 стаканов за день», а сегодня выпито 0');
});

test('r1-06-06: прогресс «прожила неделю» после смерти жабы обнуляется', () => {
  const h = harness({}, T0);
  // 2 дня живёт (ночи по 12 ч — без смерти), потом умирает
  for (let d = 0; d < 2; d++) { h.tick(12 * HOUR, 0); h.tick(12 * HOUR, 0); }
  h.check([]);
  h.untilDead();
  h.act('revive');
  const pr = h.A.list().find((a) => a.id === 'alive7').progress;
  assert.strictEqual(h.pet.view(h.t).ageMin, 0);
  assert.deepStrictEqual(pr, { cur: 0, max: 7 });
});

test('r1-06-07: zero_downtime не выдаётся за день, который жаба целиком пролежала мёртвой', () => {
  const h = harness({}, new Date(2026, 9, 13, 20, 0).getTime());
  h.untilDead(); // умерла вечером 13-го
  // всю ночь и весь день 14-го компьютер включён (тики каждую минуту, человек то уходит, то работает)
  const end = new Date(2026, 9, 15, 0, 30).getTime();
  let n = 0;
  while (h.t < end) {
    h.tick(MIN, 1);
    if (h.pet.state.day.date === '2026-10-14' && n < 6 && new Date(h.t).getHours() >= 10) { h.act('drink'); n++; }
  }
  assert.strictEqual(h.pet.view(h.t).life, 'dead', 'жаба так и не воскресала');
  assert.ok(!h.got.includes('zero_downtime'), '«Целый день без смертей» при 100% downtime');
});

test('r1-06-08: balanced («за день … ни разу не сидел дольше часа») не выдаётся через минуту после начала дня', () => {
  const h = harness({}, new Date(2026, 9, 14, 9, 0).getTime());
  for (let i = 0; i < 6; i++) { h.act('drink'); h.act('stretch'); }
  h.tick(MIN, 0);
  assert.ok(!h.got.includes('balanced'), 'день только начался — условие «за день» ещё не проверить');
});

test('r1-06-09: iron_butt достижима в хардкоре при moveEvery=45 из настроек', () => {
  const h = harness({ moveEvery: 45, waterEvery: 90 }, T0);
  h.untilDead(); // сидел до окаменения — дольше сидеть физически нельзя
  assert.strictEqual(h.pet.view(h.t).cause, 'stone');
  assert.ok(h.got.includes('iron_butt'), 'sitMin=' + h.pet.view(h.t).sitMin + ': «2 часа» недостижимы, жаба каменеет на 108 мин');
});
