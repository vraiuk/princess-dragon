'use strict';
// R3-06: падающие тесты-доказательства. Каждый падает на текущем коде и должен проходить после фикса.
//   node --test qa/findings/r3-06.test.js
// r3-06-06 гоняет фазз на мутанте core (~15 с).
process.env.TZ = 'Europe/Berlin';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const Core = require('../../app/core');
const { MIN, HOUR } = Core;

const T0 = new Date(2026, 9, 19, 10, 0, 0).getTime();
const types = (ev) => ev.map((e) => e.type);

function sitFor(pet, t, minutes, idle = 0) {
  for (let i = 0; i < minutes * 3; i++) { t += 20 * 1000; pet.tick(t, idle); }
  return t;
}

test('r3-06-01: часы назад и сразу обратно вперёд (≥2 тика на неверных часах) — не «ночь»', () => {
  const pet = Core.createPet(null, {}, T0);
  pet.tick(T0, 0);
  let t = T0;
  while (pet.view(t).life === 'alive') { t += 20 * 1000; pet.tick(t, 0); }
  // часы ошибочно перевели на 7 ч назад; три тика по 20 с идут по неверным часам
  let c = t - 7 * HOUR;
  for (let i = 0; i < 3; i++) { c += 20 * 1000; pet.tick(c, 0); }
  // ошибку заметили и вернули часы: реально прошло 80 секунд
  const ev = pet.tick(t + 80 * 1000, 0);
  assert.deepStrictEqual(types(ev), [], 'за 80 реальных секунд жаба не должна воскреснуть и получить «утро»');
  assert.strictEqual(pet.view(t + 80 * 1000).life, 'dead');
});

test('r3-06-02: включение хардкора не уменьшает рекорд сидения (день и всё время)', () => {
  const pet = Core.createPet(null, { deathEnabled: false }, T0);
  pet.tick(T0, 0);
  const t = sitFor(pet, T0, 180);
  assert.strictEqual(pet.view(t).totals.maxSitMs, 180 * MIN);
  pet.setSettings({ deathEnabled: true }); // sitMs обрезается до 96 мин без записи рекорда
  assert.strictEqual(pet.view(t).totals.maxSitMs, 180 * MIN, 'рекорд «за всё время» усох');
  assert.strictEqual(pet.view(t).day.maxSit, 180, 'рекорд дня усох');
});

test('r3-06-03: настоящий перевод часов назад + 6.5 ч реального сна = утро (jump-guard съедает время)', () => {
  const pet = Core.createPet(null, {}, T0);
  pet.tick(T0, 0);
  let t = sitFor(pet, T0, 1);
  const c = t - HOUR + 20 * 1000;           // часы перевели на час назад насовсем
  pet.tick(c, 0);
  const ev = pet.tick(c + 6.5 * HOUR, 0);   // крышку закрыли на 6.5 реальных часов
  assert.ok(types(ev).includes('morning'), `после 6.5 ч сна ждали morning, получили ${JSON.stringify(types(ev))}`);
});

test('r3-06-04: возврат после перевода часов назад во время отсутствия — перерыв не отрицательный', () => {
  const pet = Core.createPet(null, {}, T0);
  pet.tick(T0, 0);
  let t = sitFor(pet, T0, 10, 600);        // человек ушёл
  let c = t - 3 * HOUR;
  pet.tick(c += 20 * 1000, 700);
  const ev = pet.tick(c += 20 * 1000, 0);   // вернулся
  const back = ev.find((e) => e.type === 'back');
  assert.ok(back, 'ждали back');
  assert.ok(back.min >= 0, `back.min=${back.min}, текст «${back.text}»`);
});

test('r3-06-05: совместный тик — игнорируемое напоминание разминки (nag≥2) не теряет уведомление из-за первого стакана', () => {
  // реальные события core: на 80-й минуте вода впервые (nag 1) и разминка в 4-й раз — в одном тике
  const pet = Core.createPet(null, {}, T0);
  pet.tick(T0, 0);
  let t = T0, joint = null;
  for (let i = 0; i < 90 * 3 && !joint; i++) {
    t += 20 * 1000;
    if (i === 35 * 3) pet.drink(t);
    const ev = pet.tick(t, 0).filter((e) => e.type === 'remind');
    if (ev.length === 2) joint = ev;
  }
  assert.ok(joint, 'совместный тик не найден');
  assert.deepStrictEqual(joint.map((e) => e.kind + '#' + e.nag), ['water#1', 'move#4']);
  // handleEvent из app/main.js как есть, с заглушками electron
  const src = fs.readFileSync(path.join(__dirname, '../../app/main.js'), 'utf8');
  const a = src.indexOf('let lastNagAt');
  const b = src.indexOf('\n}\n', src.indexOf('function handleEvent')) + 3;
  const notes = [];
  const ctx = {
    film: null, hidden: false, settings: { nagEvery: 10 }, Date, Object,
    send() {}, rebuildMenu() {}, age: (m) => m + ' мин',
    notify: (title, body) => notes.push(title + ' / ' + body),
    pet: { view: () => pet.view(t) },
  };
  vm.runInNewContext(src.slice(a, b) + '\nthis.handleEvent = handleEvent;', ctx);
  joint.forEach((e) => ctx.handleEvent(e));
  assert.ok(notes.length >= 1, 'move#4 (4-й игнор подряд) без уведомления: громким стало water#1, а оно уведомление не даёт');
});

test('r3-06-06: фазз ловит мутант «напоминание каждый тик» (nextNag = t)', () => {
  const core = fs.readFileSync(path.join(__dirname, '../../app/core.js'), 'utf8');
  const from = 'st.nextNag[kind] = t + S.nagEvery * MIN;';
  assert.ok(core.includes(from), 'мутируемая строка не найдена');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-06-'));
  const mut = path.join(dir, 'core.mut.js');
  fs.writeFileSync(mut, core.replace(from, 'st.nextNag[kind] = t;'));
  const r = spawnSync(process.execPath, ['--test', path.join(__dirname, '../../test/fuzz.test.js')], {
    env: Object.assign({}, process.env, { FUZZ_CORE: mut }), encoding: 'utf8', timeout: 240000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notStrictEqual(r.status, 0, 'фазз зелёный на мутанте, который шлёт напоминание каждые 20 с');
});
