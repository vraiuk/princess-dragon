'use strict';
// Фазз-симуляция: случайные «рабочие недели» по многим сидам и проверка инвариантов.
// Каждый сид — отдельный прогон из чистого состояния; падение печатает сид для воспроизведения:
//   FUZZ_SEED=123 node --test test/fuzz.test.js
// Мутационная проверка самого фазза — подставить сломанную копию модуля:
//   FUZZ_CORE=/tmp/core.mut.js FUZZ_ACH=/tmp/achievements.mut.js node --test test/fuzz.test.js
// Часовой пояс с переводом часов (по умолчанию Europe/Berlin), чтобы недели проходили через DST:
//   FUZZ_TZ=America/New_York npm test
process.env.TZ = process.env.FUZZ_TZ || 'Europe/Berlin';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const Core = require(process.env.FUZZ_CORE ? path.resolve(process.env.FUZZ_CORE) : '../app/core');
const Ach = require(process.env.FUZZ_ACH ? path.resolve(process.env.FUZZ_ACH) : '../app/achievements');

const { MIN, HOUR } = Core;
const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : Array.from({ length: Number(process.env.FUZZ_RUNS) || 40 }, (_, i) => 1000 + i);
const KIND_OF_CAUSE = { dry: 'water', stone: 'move' };
const CRIT = Core.CRITICAL - 1e-9;
// Старты недель: обе включают перевод часов в Европе (29 марта и 25 октября 2026)
const STARTS = [new Date(2026, 2, 23, 8, 0, 0).getTime(), new Date(2026, 9, 19, 8, 0, 0).getTime()];
// Ачивки, которых за 14 дней симуляции не бывает по построению (30 дней жизни, 100 стаканов/перерывов…)
const OUT_OF_REACH = new Set(['alive30', 'aquarium', 'stretch100', 'streak7', 'leet']);

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function simulate(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  // «враждебный» прогон (каждый 4-й сид): настройки как из руками правленного frog.json, скачки часов, NaN
  const hostile = seed % 4 === 3;
  // «образцовый» прогон (каждый 4-й сид): часто пьёт и разминается — иначе дневные ачивки и серии недостижимы
  const diligent = seed % 4 === 1;
  let settings = Object.assign({}, Core.DEFAULTS, { deathEnabled: r() < 0.8 });
  let t = pick(STARTS) + Math.floor(r() * 12 * HOUR);
  let real = t;                 // настоящее время; t — то, что показывают часы компьютера
  let lastReal = t;             // настоящее время прошлого тика
  let pet = Core.createPet(null, settings, t);
  let ach = Ach.createAchievements(null);
  const unlocked = new Set();
  const log = [];
  let idleStart = t;            // когда человек последний раз трогал мышь
  let critSeen = { water: false, move: false };
  let lastDoom = { water: 0, move: 0 };
  let checkMs = 0, checks = 0;
  let deadBefore = false;
  // частота напоминаний: когда было последнее громкое напоминание каждого вида и при каком nagEvery;
  // free[k] — «Позже» или смена настроек: следующий повтор k законно может прийти раньше
  const lastNag = { water: null, move: null };
  let free = { water: false, move: false };
  let lastClock = t;

  const fail = (msg) => { throw new Error(`seed=${seed} t=${new Date(t).toISOString()}: ${msg}\n  last: ${log.slice(-8).join(' | ')}`); };

  // Если доля пути до смерти упала ниже зоны critical (попил, размялся, ушёл, ночь) — core обязан
  // предупредить заново. Смена настроек долю тоже меняет, но это не «спасение», поэтому её не считаем.
  function trackDoom(byUser) {
    const v = pet.view(t);
    for (const k of ['water', 'move']) {
      const d = v.doom[k];
      if (byUser && v.life === 'alive' && d < CRIT && d < lastDoom[k]) critSeen[k] = false;
      lastDoom[k] = d;
    }
  }

  // Повтор напоминания (nag ≥ 2, не тихий) приходит не раньше nagEvery после прошлого громкого
  // напоминания того же вида и — совместный ритм — после прошлого напоминания другого вида. Первое
  // напоминание после сброса (попил, размялся, отошёл, новая жаба: nag = 1) идёт по своему таймеру.
  function checkNag(ev, now) {
    if (ev.quiet) return;
    const k = ev.kind;
    if (ev.nag > 1 && !free[k]) {
      for (const other of ['water', 'move']) {
        const prev = lastNag[other];
        if (!prev || !(now > prev.at)) continue; // то же тик (вместе) или часы ушли назад
        const every = Math.min(prev.every, settings.nagEvery) * MIN;
        if (now - prev.at < every - 1) {
          fail(`напоминание ${k} #${ev.nag} через ${Math.round((now - prev.at) / 1000)} с после ${other} (nagEvery ${every / MIN} мин)`);
        }
      }
    }
    free[k] = false;
    lastNag[k] = { at: now, every: settings.nagEvery };
  }

  function handle(events, gap, now) {
    const wasDead = deadBefore; // состояние до тика/действия: само событие могло уже убить жабу
    for (const ev of events) {
      log.push(ev.type + (ev.kind ? ':' + ev.kind : '') + (ev.cause ? ':' + ev.cause : ''));
      if (ev.type === 'critical') critSeen[ev.kind] = true;
      if (ev.type === 'death') {
        const k = KIND_OF_CAUSE[ev.cause];
        if (!k) fail(`неизвестная причина смерти ${ev.cause}`);
        if (!settings.deathEnabled) fail('смерть при выключенном хардкоре');
        if (!critSeen[k]) fail(`смерть (${ev.cause}) без свежего предупреждения critical`);
        if ((t - idleStart) / 1000 >= settings.breakAfter * 60) fail('смерть, пока человек отошёл');
        if (gap != null && gap >= settings.breakAfter * MIN) fail(`смерть в тике после ${Math.round(gap / MIN)} мин без тиков (человек «отошёл»)`);
      }
      if (ev.type === 'reborn') critSeen = { water: false, move: false };
      if (gap != null && (ev.type === 'morning' || ev.type === 'reborn') && gap <= 2 * HOUR) {
        fail(`${ev.type} после ${Math.round(gap / 1000)} с настоящего времени (скачок часов принят за ночь)`);
      }
      if (ev.type === 'remind') {
        const v = pet.view(t);
        if (v.life === 'dead') fail('напоминание мёртвой жабе');
        if (v.paused) fail('напоминание на паузе');
        checkNag(ev, now === undefined ? t : now);
      }
      if (wasDead && (ev.type === 'back' || ev.type === 'resumed' || ev.type === 'critical') && /камень осыпался|на посту|⚠️/.test(ev.text || '')) {
        fail(`мёртвой жабе: ${ev.type} «${ev.text}»`);
      }
    }
    deadBefore = pet.view(t).life === 'dead';
    const t0 = process.hrtime.bigint();
    const got = ach.check({ now: t, events, view: pet.view(t), state: pet.serialize(), settings });
    checkMs += Number(process.hrtime.bigint() - t0) / 1e6; checks++;
    for (const a of got) {
      if (unlocked.has(a.id)) fail(`ачивка ${a.id} выдана повторно`);
      unlocked.add(a.id);
    }
  }

  // тик с часами feed (по умолчанию t); настоящее время между тиками — gap
  function tick(idleSec, feed) {
    const gap = real - lastReal;
    lastReal = real;
    const now = feed === undefined ? t : feed;
    // часы ушли назад: интервалы между напоминаниями по часам больше ничего не значат
    if (now < lastClock) { lastNag.water = null; lastNag.move = null; }
    if (Number.isFinite(now)) lastClock = now;
    handle(pet.tick(now, idleSec), gap, now);
    trackDoom(true);
  }
  const advance = (ms) => { t += ms; real += ms; };

  function checkAch() {
    const list = ach.list();
    const got = new Set(list.filter((a) => a.unlocked).map((a) => a.id));
    for (const id of unlocked) if (!got.has(id)) fail(`ачивка ${id} выдана, но в list() не получена`);
    for (const id of got) if (!unlocked.has(id)) fail(`ачивка ${id} в list() получена, но check() её не выдавал`);
    for (const a of list) {
      if (a.kind === 'secret' && !a.unlocked && (!a.hidden || a.progress)) fail(`секрет ${a.id} не замаскирован`);
      if (!a.progress) continue;
      const { cur, max } = a.progress;
      if (!(cur >= 0 && cur <= max)) fail(`прогресс ${a.id} ${cur}/${max} вне диапазона`);
      if (a.unlocked && cur !== max) fail(`ачивка ${a.id} получена, а прогресс ${cur}/${max}`);
      if (!a.unlocked && cur >= max) fail(`прогресс ${a.id} ${cur}/${max} полный, а ачивка не выдана`);
    }
  }

  function checkView() {
    const v = pet.view(t);
    for (const k of ['glass', 'dry', 'stone']) {
      if (!(v[k] >= 0 && v[k] <= 1)) fail(`view.${k}=${v[k]} вне [0,1]`);
    }
    if (v.life === 'dead' && !['dry', 'stone'].includes(v.cause)) fail(`мертва без причины: ${v.cause}`);
    const st = pet.serialize();
    for (const k of ['waterMs', 'sitMs', 'lastTick', 'bornAt']) if (!Number.isFinite(st[k])) fail(`state.${k}=${st[k]}`);
    if (!/^\d{4}-\d\d-\d\d$/.test(st.day && st.day.date)) fail(`state.day.date=${st.day && st.day.date}`);
    if ((st.graveyard || []).length > 50) fail('кладбище больше 50');
    if ((st.history || []).length > 30) fail('history больше 30');
    const dates = (st.history || []).map((d) => d.date);
    if (new Set(dates).size !== dates.length) fail('дубли дат в history');
    for (let i = 1; i < dates.length; i++) if (!(dates[i - 1] < dates[i])) fail(`history не по порядку: ${dates[i - 1]} → ${dates[i]}`);
    if (dates.length && !(dates[dates.length - 1] < st.day.date)) fail(`сегодня ${st.day.date} не позже history ${dates[dates.length - 1]}`);
    checkAch();
  }

  function weirdSettings() {
    // числа, которые cleanSettings пропускает из frog.json: любые положительные
    return {
      waterEvery: pick([1, 2, 3, 5, 7, 12, 30, 45, 200]), moveEvery: pick([1, 2, 4, 9, 30, 50, 240]),
      breakAfter: pick([1, 2, 5, 15, 30]), nagEvery: pick([1, 3, 10, 60]),
    };
  }

  // один «шаг» поведения человека
  function step() {
    const modes = ['work', 'work', 'work', 'read', 'away', 'lunch', 'sleep', 'action', 'action', 'restart', 'settings', 'freeze'];
    if (hostile) modes.push('clock', 'clock');
    if (diligent) modes.push('care', 'care', 'care', 'care', 'care', 'care');
    if (r() < 0.1) modes.push('pokes');
    const mode = pick(modes);
    if (mode === 'work' || mode === 'read') {
      const minutes = 5 + Math.floor(r() * 60);
      for (let i = 0; i < minutes * 3; i++) {
        advance(20 * 1000);
        if (mode === 'work' || r() < 0.2) idleStart = t - Math.floor(r() * 3000);
        tick((t - idleStart) / 1000);
      }
    } else if (mode === 'away' || mode === 'lunch') {
      const minutes = mode === 'lunch' ? 40 + Math.floor(r() * 50) : 3 + Math.floor(r() * 15);
      for (let i = 0; i < minutes * 3; i++) { advance(20 * 1000); tick((t - idleStart) / 1000); }
      idleStart = t;
      advance(1000);
      tick(0);
    } else if (mode === 'sleep') {
      advance((2 + r() * 14) * HOUR + 1000); // крышка закрыта, тиков нет
      idleStart = t;
      tick(0);
    } else if (mode === 'freeze') {
      // приложение подвисло / ноутбук уснул ненадолго: один тик через 20 с … 2 ч, человек сразу за компом
      advance(20 * 1000 + Math.floor(r() * (2 * HOUR - 20 * 1000)));
      idleStart = t;
      tick(0);
      for (let i = 0; i < 6; i++) { advance(20 * 1000); idleStart = t; tick(0); }
    } else if (mode === 'clock') {
      const shift = pick([1, 5, 30, 90, 7 * 60, 15 * 60]) * MIN;
      if (r() < 0.5) {
        // разовый тик из прошлого (NTP, кривой источник времени), потом часы снова верные
        tick((t - idleStart) / 1000, r() < 0.3 ? NaN : t - shift);
        advance(20 * 1000);
        tick((t - idleStart) / 1000);
      } else {
        // часы перевели назад насовсем (смена пояса, ручная правка)
        t -= shift; idleStart = Math.min(idleStart, t);
        advance(20 * 1000);
        tick((t - idleStart) / 1000);
      }
    } else if (mode === 'care') {
      // попил и размялся, потом поработал 15–45 мин
      idleStart = t;
      handle([pet.drink(t)]); trackDoom(true);
      advance(30 * 1000); idleStart = t;
      handle([pet.stretch(t)]); trackDoom(true);
      const minutes = 15 + Math.floor(r() * 30);
      for (let i = 0; i < minutes * 3; i++) { advance(20 * 1000); idleStart = t - 1000; tick(1); }
    } else if (mode === 'pokes') {
      // серия тычков раз в секунду
      for (let i = 0, n = 8 + Math.floor(r() * 6); i < n; i++) { advance(1000); idleStart = t; handle([pet.poke()]); }
      tick(0);
    } else if (mode === 'action') {
      idleStart = t;
      const a = pick(['drink', 'drink', 'stretch', 'snooze', 'poke', 'pause', 'revive', 'dragged']);
      let ev = null;
      if (a === 'drink') ev = pet.drink(t);
      else if (a === 'stretch') ev = pet.stretch(t);
      else if (a === 'snooze') { const k = pick(['water', 'move']); pet.snooze(k, t, 10); free[k] = true; ev = { type: 'snooze' }; }
      else if (a === 'poke') ev = pet.poke();
      else if (a === 'pause') ev = pet.pause(t, pick([0, 1, 30, 60]));
      else if (a === 'revive' && pet.view(t).life === 'dead') ev = pet.revive(t);
      else if (a === 'dragged') ev = { type: 'dragged' };
      if (ev) handle([ev]);
      trackDoom(true);
    } else if (mode === 'restart') {
      pet = Core.createPet(JSON.parse(JSON.stringify(pet.serialize())), settings, t);
      ach = Ach.createAchievements(JSON.parse(JSON.stringify(ach.serialize())));
      trackDoom(false);
    } else if (mode === 'settings') {
      settings = Object.assign({}, settings, hostile && r() < 0.5 ? weirdSettings() : {
        waterEvery: pick([30, 45, 60, 90]), moveEvery: pick([30, 45, 50, 60, 90]), breakAfter: pick([3, 5, 10]),
      });
      pet.setSettings(settings);
      // интервалы сменились: доля пути и nagEvery другие, ближайший повтор законно сдвигается
      free = { water: true, move: true };
      // смена хардкора поверх critical — сбрасываем ожидание предупреждения, core обязан выдать его заново
      if (r() < 0.15) {
        settings = Object.assign({}, settings, { deathEnabled: !settings.deathEnabled });
        pet.setSettings(settings);
        critSeen = { water: false, move: false };
        // хардкор включили, когда жаба «за гранью»: доля пути обрезается до critical — сперва предупредить
        const v = pet.view(t);
        if (settings.deathEnabled && v.life === 'alive') {
          for (const k of ['water', 'move']) if (v.doom[k] > Core.CRITICAL + 1e-9) fail(`хардкор включён при doom.${k}=${v.doom[k].toFixed(3)} > critical: смерть без запаса на предупреждение`);
        }
      }
      trackDoom(false);
    }
    checkView();
  }

  tick(0);
  const end = real + 14 * 24 * HOUR;
  while (real < end) step();
  return { seed, ids: unlocked, unlocked: unlocked.size, deaths: pet.view(t).totals.deaths, avgCheckMs: checkMs / checks };
}

test(`фазз: ${SEEDS.length} случайных недель без нарушений инвариантов`, () => {
  const results = SEEDS.map(simulate);
  const deaths = results.reduce((s, x) => s + x.deaths, 0);
  const avg = results.reduce((s, x) => s + x.avgCheckMs, 0) / results.length;
  // проверка самой проверки: смерти и ачивки вообще случаются, иначе фазз ничего не тестирует
  assert.ok(deaths > 0, 'ни одной смерти — симуляция слишком мягкая');
  assert.ok(results.every((x) => x.unlocked > 0), 'есть прогон без единой ачивки');
  assert.ok(avg < 2, `check() слишком медленный: ${avg.toFixed(3)} мс`);
  // достижимость: на полном наборе сидов каждая ачивка, кроме заведомо долгих, хоть раз выдана
  if (SEEDS.length >= 40) {
    const seen = new Set(results.flatMap((x) => [...x.ids]));
    const never = Ach.DEFS.map((d) => d.id).filter((id) => !seen.has(id) && !OUT_OF_REACH.has(id));
    assert.deepStrictEqual(never, [], 'ни разу не выданы за все недели');
  }
});
