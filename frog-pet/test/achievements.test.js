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
  r = run(pet, A, r.t, 20); got.push(...r.got);    // 80 + 20 = 100 мин реального сидения (порог при дефолтах 0.9 × 2.4 × 50 = 108)
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


// ---- R2 (F2): прогресс = текущий факт, честные «дневные» ачивки ----

function harness(settings, t0) {
  const h = { t: t0, pet: Core.createPet(null, settings || {}, t0), A: createAchievements(null), got: [] };
  h.check = (events) => { h.got.push(...ids(h.A.check({ now: h.t, events, view: h.pet.view(h.t), state: h.pet.serialize(), settings: {} }))); };
  h.tick = (dt, idle = 1) => { h.t += dt; h.check(h.pet.tick(h.t, idle)); };
  h.act = (name) => { h.check([h.pet[name](h.t)]); };
  h.untilDead = () => { let i = 0; while (h.pet.view(h.t).life === 'alive' && i++ < 5000) h.tick(20 * 1000); };
  h.check(h.pet.tick(h.t, 0));
  return h;
}
const prog = (A, id) => A.list().find((a) => a.id === id).progress;

test('r1-06-05: прогресс дневной ачивки — сегодняшний факт, а не рекорд прошлых дней', () => {
  const h = harness({}, new Date(2026, 9, 14, 12).getTime());
  for (let i = 0; i < 5; i++) { h.act('drink'); h.t += MIN; }
  assert.deepStrictEqual(prog(h.A, 'hydrated'), { cur: 5, max: 8 });
  h.tick(14 * HOUR, 0); // ночь, новый день
  assert.deepStrictEqual(prog(h.A, 'hydrated'), { cur: 0, max: 8 });
  // накопительные счётчики при этом не теряются
  assert.deepStrictEqual(prog(h.A, 'aquarium'), { cur: 5, max: 100 });
});

test('r1-06-05: прогресс возраста и серии обнуляется вместе с жабой/серией', () => {
  const h = harness({}, new Date(2026, 9, 14, 12).getTime());
  for (let d = 0; d < 2; d++) { h.tick(12 * HOUR, 0); h.tick(12 * HOUR, 0); }
  assert.deepStrictEqual(prog(h.A, 'alive7'), { cur: 2, max: 7 });
  h.untilDead();
  h.act('revive');
  assert.deepStrictEqual(prog(h.A, 'alive7'), { cur: 0, max: 7 });
  // после перезапуска полученные остаются max/max
  const B = createAchievements(JSON.parse(JSON.stringify(h.A.serialize())));
  assert.deepStrictEqual(B.list(), h.A.list());
});

test('r1-06-06: zero_downtime не выдаётся за день, который жаба пролежала мёртвой', () => {
  const h = harness({}, new Date(2026, 9, 13, 20).getTime());
  h.untilDead(); // умерла вечером 13-го
  const end = new Date(2026, 9, 15, 0, 30).getTime();
  let n = 0;
  while (h.t < end) {
    h.tick(MIN, 1);
    if (h.pet.state.day.date === '2026-10-14' && n < 6 && new Date(h.t).getHours() >= 10) { h.act('drink'); n++; }
  }
  assert.strictEqual(h.pet.view(h.t).life, 'dead');
  assert.ok(!h.got.includes('zero_downtime'), h.got.join(','));
});

test('r1-06-07: balanced оценивается по закрытому дню, а не через минуту после его начала', () => {
  const day = (d, o) => Object.assign({ date: Core.dayKey(new Date(2026, 9, d).getTime()), drinks: 6, breaks: 0, autoBreaks: 6, maxSitMs: 50 * MIN }, o);
  // сегодня всё сделано, но день ещё не закрыт
  let A = createAchievements(null);
  let got = ids(A.check({ now: new Date(2026, 9, 14, 9, 1).getTime(), events: [], view: {}, state: { history: [], day: day(14, { maxSitMs: 0 }) } }));
  assert.ok(!got.includes('balanced'));
  // вчера 6/6, но был час с лишним на стуле — нет
  got = ids(A.check({ now: new Date(2026, 9, 15, 9).getTime(), events: [], view: {}, state: { history: [day(14, { maxSitMs: 70 * MIN })], day: day(15, { drinks: 0, autoBreaks: 0 }) } }));
  assert.ok(!got.includes('balanced'));
  // закрытый день 6 стаканов, 6 перерывов (авто тоже перерывы), ≤ 60 мин на стуле — да
  A = createAchievements(null);
  got = ids(A.check({ now: new Date(2026, 9, 15, 9).getTime(), events: [], view: {}, state: { history: [day(14)], day: day(15, { drinks: 0, autoBreaks: 0 }) } }));
  assert.ok(got.includes('balanced'));
  assert.match(DEFS.find((d) => d.id === 'balanced').desc, /6 перерывов/);
});

// ---- R4 (G10): пороги ачивок согласованы с настройками ----

const MOVE = [30, 45, 50, 60, 90], WATER = [30, 45, 60, 90]; // значения из settings.html

// Человек пьёт вовремя, но не встаёт; check получает те же настройки, что и жаба (как main и демо)
function sitter(settings) {
  const t0 = new Date(2026, 9, 19, 10, 0).getTime();
  const pet = Core.createPet(null, settings, t0);
  const A = createAchievements(null);
  const got = [];
  let t = t0, lastDrink = t0, aliveAtIron = null;
  const check = (events) => {
    const fresh = ids(A.check({ now: t, events, view: pet.view(t), state: pet.serialize(), settings }));
    if (fresh.includes('iron_butt')) aliveAtIron = pet.view(t).life === 'alive';
    got.push(...fresh);
  };
  check(pet.tick(t, 0));
  for (let i = 0; i < 6 * 180 && !got.includes('iron_butt') && pet.view(t).life === 'alive'; i++) {
    t += 20 * 1000;
    check(pet.tick(t, 1));
    if (t - lastDrink >= (settings.waterEvery - 1) * MIN) { lastDrink = t; check([pet.drink(t)]); }
  }
  return { got, aliveAtIron, view: pet.view(t) };
}

test('ironMin совпадает с порогами core и решением: min(120, 0.9 × время до камня)', () => {
  assert.strictEqual(FrogAchievements.DEATH_STONE, Core.DEATH_STONE);
  assert.strictEqual(FrogAchievements.DEATH_WATER, Core.DEATH_WATER);
  for (const k of Object.keys(FrogAchievements.DEF_SET)) assert.strictEqual(FrogAchievements.DEF_SET[k], Core.DEFAULTS[k], k);
  const im = FrogAchievements.ironMin;
  assert.strictEqual(im({ moveEvery: 30, deathEnabled: true }), 0.9 * 2.4 * 30);
  assert.strictEqual(im({ moveEvery: 90, deathEnabled: true }), 120);
  assert.strictEqual(im({ moveEvery: 30, deathEnabled: false }), 120);
  assert.strictEqual(im({}), 0.9 * 2.4 * 50, 'нет настроек — дефолты core');
  assert.strictEqual(im({ moveEvery: NaN }), 0.9 * 2.4 * 50);
});

test('r1-06-08: iron_butt достижима при любых moveEvery × waterEvery × хардкор', () => {
  for (const moveEvery of MOVE) for (const waterEvery of WATER) for (const deathEnabled of [true, false]) {
    const set = Object.assign({}, Core.DEFAULTS, { moveEvery, waterEvery, deathEnabled });
    const r = sitter(set);
    const tag = JSON.stringify({ moveEvery, waterEvery, deathEnabled }) + ' sitMin=' + r.view.sitMin + ' ' + r.view.life + '/' + r.view.cause;
    assert.ok(r.got.includes('iron_butt'), tag);
    assert.strictEqual(r.aliveAtIron, true, 'выдаётся до окаменения: ' + tag);
  }
});

test('r1-06-08: iron_butt не раньше порога (2 ч без хардкора, 108 мин при дефолтах)', () => {
  for (const [set, lim] of [[Object.assign({}, Core.DEFAULTS), 108], [Object.assign({}, Core.DEFAULTS, { moveEvery: 90, deathEnabled: false }), 120]]) {
    const A = createAchievements(null);
    const view = (sitMin) => ({ life: 'alive', sitMin });
    assert.ok(!ids(A.check({ now: T0, events: [], view: view(lim - 1), state: {}, settings: set })).includes('iron_butt'), String(lim));
    assert.ok(ids(A.check({ now: T0, events: [], view: view(lim), state: {}, settings: set })).includes('iron_butt'), String(lim));
  }
  assert.match(DEFS.find((d) => d.id === 'iron_butt').desc, /2 ч/);
});

// Полное безразличие: ни воды, ни разминки, за компом
function neglect(settings) {
  const h = { t: T0, pet: Core.createPet(null, settings, T0), A: createAchievements(null), got: [] };
  const check = (events) => h.got.push(...ids(h.A.check({ now: h.t, events, view: h.pet.view(h.t), state: h.pet.serialize(), settings })));
  check(h.pet.tick(h.t, 0));
  h.step = (n, drinkAt) => {
    for (let i = 0; i < n && h.pet.view(h.t).life === 'alive'; i++) {
      h.t += 20 * 1000; check(h.pet.tick(h.t, 1));
      if (drinkAt && i === drinkAt) check([h.pet.drink(h.t)]);
    }
  };
  return h;
}

test('r1-06-08: speedrun достижима в хардкоре при любых интервалах (жаба без воды и перерывов)', () => {
  for (const moveEvery of MOVE) for (const waterEvery of WATER) {
    const set = Object.assign({}, Core.DEFAULTS, { moveEvery, waterEvery });
    const h = neglect(set);
    h.step(3 * 24 * 180);
    const v = h.pet.view(h.t);
    assert.strictEqual(v.life, 'dead', JSON.stringify(set));
    assert.ok(h.got.includes('speedrun'), JSON.stringify({ moveEvery, waterEvery, ageMin: v.ageMin }));
  }
});

test('r1-06-08: speedrun — «за 3 часа»; за заботу и долгую жизнь не выдаётся', () => {
  // дефолты: стакан на 10-й минуте, смерть от камня через 2 ч — меньше 3 ч
  let h = neglect(Object.assign({}, Core.DEFAULTS));
  h.step(10000, 30);
  assert.ok(h.pet.view(h.t).ageMin < 180 && h.got.includes('speedrun'), h.got.join(','));
  // 90/90: стакан был, умерла позже 3 ч — нет
  h = neglect(Object.assign({}, Core.DEFAULTS, { moveEvery: 90, waterEvery: 90 }));
  h.step(10000, 30);
  assert.strictEqual(h.pet.view(h.t).life, 'dead');
  assert.ok(h.pet.view(h.t).ageMin >= 180 && !h.got.includes('speedrun'), h.pet.view(h.t).ageMin + ' ' + h.got.join(','));
  // старое сохранение без поля cared: не выдаём за чужие стаканы до первого перерождения
  const B = createAchievements({ s: { drinks: 3 } });
  const got = ids(B.check({ now: T0, events: [{ type: 'death', cause: 'stone', ageMin: 300 }], view: { life: 'dead' }, state: {} }));
  assert.ok(!got.includes('speedrun'), got.join(','));
});

test('alive3/7/30: возраст по календарю, и текст об этом говорит честно', () => {
  for (const [id, n] of [['alive3', 3], ['alive7', 7], ['alive30', 30]]) {
    assert.match(DEFS.find((d) => d.id === id).desc, new RegExp('^Жаба живёт ' + n + ' дн[а-я]* по календарю'), id);
  }
  // приложение закрыто 3 дня — жаба всё равно живёт 3 дня
  const pet = Core.createPet(null, {}, T0);
  const A = createAchievements(null);
  pet.tick(T0, 0);
  A.check({ now: T0, events: [], view: pet.view(T0), state: pet.serialize() });
  const t = T0 + 3 * 24 * HOUR;
  const ev = pet.tick(t, 0);
  assert.ok(ids(A.check({ now: t, events: ev, view: pet.view(t), state: pet.serialize() })).includes('alive3'));
});
