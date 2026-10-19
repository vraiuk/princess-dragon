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


// ---- T2: реальные дни ----

test('«Ночная жаба» — по местному времени, а не по UTC', () => {
  const { spawnSync } = require('node:child_process');
  // 18:00 UTC: в Токио 3:00 ночи, в Лос-Анджелесе 11:00 утра
  const code = `
    const Core = require(${JSON.stringify(require.resolve('../app/core'))});
    const { createAchievements } = require(${JSON.stringify(require.resolve('../app/achievements'))});
    const t = Date.UTC(2026, 9, 20, 18, 0, 0);
    const pet = Core.createPet(null, {}, t); pet.tick(t, 0); pet.tick(t + 1000, 1);
    const got = createAchievements(null).check({ now: t + 1000, events: [], view: pet.view(t + 1000), state: pet.serialize() });
    process.stdout.write(String(got.some((a) => a.id === 'night')));`;
  const run = (TZ) => spawnSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ }) }).stdout.toString();
  assert.strictEqual(run('Asia/Tokyo'), 'true');
  assert.strictEqual(run('America/Los_Angeles'), 'false');
});

test('«Железножопая» не выдаётся за созвон на паузе и за сидение с перерывами', () => {
  const pet = Core.createPet(null, {}, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  let { t, got } = run(pet, A, T0, 80);
  pet.pause(t, 60);
  let r = run(pet, A, t, 60); got.push(...r.got);  // созвон на паузе
  r = run(pet, A, r.t, 30); got.push(...r.got);    // 80 + 30 = 110 мин реального сидения
  const idleFrom = r.t;
  r = run(pet, A, r.t, 6, (now) => (now - idleFrom) / 1000); got.push(...r.got);   // перерыв
  r = run(pet, A, r.t, 90); got.push(...r.got);
  assert.ok(!ids(got).includes('iron_butt'), ids(got).join(','));
});

test('серия ломается на пропущенном дне', () => {
  const A = createAchievements(null);
  const day = (d) => ({ date: Core.dayKey(new Date(2026, 9, d).getTime()), drinks: 7, breaks: 3, autoBreaks: 2 });
  const state = { history: [day(14), day(15), day(17)], day: day(18) };   // 16-го не запускал
  const got = ids(A.check({ now: new Date(2026, 9, 18, 18).getTime(), events: [], view: {}, state }));
  assert.ok(!got.includes('streak3'));
  assert.deepStrictEqual(A.list().find((a) => a.id === 'streak3').progress, { cur: 2, max: 3 });
});

test('неделя жизни с перезапусками: ни одна ачивка не выдаётся дважды, check дешёвый', () => {
  let saved = null, savedA = null, t = new Date(2026, 9, 19, 9, 0).getTime();
  const seen = [];
  let checks = 0;
  const started = Date.now();
  for (let dayN = 0; dayN < 7; dayN++) {
    for (const half of [0, 1]) {
      // каждые полдня приложение перезапускается из сохранения
      const pet = Core.createPet(saved, {}, t);
      const A = createAchievements(savedA);
      for (let i = 0; i < 4 * 360; i++) {               // 4 часа тиками по 10 с
        t += 10000;
        const evs = pet.tick(t, i % 300 > 290 ? 400 : 1);
        if (i % 240 === 0) evs.push(pet.drink(t));
        if (i % 500 === 0) evs.push(pet.poke());
        seen.push(...ids(A.check({ now: t, events: evs, view: pet.view(t), state: pet.serialize() })));
        checks++;
      }
      saved = JSON.parse(JSON.stringify(pet.serialize()));
      savedA = JSON.parse(JSON.stringify(A.serialize()));
      t += half ? 15 * HOUR : HOUR;                     // обед / ночь
    }
  }
  const dup = seen.filter((id, i) => seen.indexOf(id) !== i);
  assert.deepStrictEqual(dup, []);
  assert.ok(seen.includes('first_drink') && seen.includes('graceful'));
  assert.ok(!seen.includes('raisin') && !seen.includes('jade') && !seen.includes('iron_butt'), seen.join(','));
  const perCheck = (Date.now() - started) / checks;
  assert.ok(perCheck < 1, `tick+check ${perCheck.toFixed(3)} мс — укладывается в секундный тик`);
});
