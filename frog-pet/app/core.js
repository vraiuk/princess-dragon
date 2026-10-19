// Логика жабы: таймеры воды и движения, напоминания, статистика, жизнь и смерть.
// Чистый модуль без зависимостей — работает и в Electron (main), и в браузерном демо.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrogCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;

  const DEFAULTS = {
    waterEvery: 45,     // мин между стаканами воды
    moveEvery: 50,      // мин непрерывного сидения до разминки
    breakAfter: 5,      // мин без мыши/клавиатуры = ушёл, перерыв засчитан
    nagEvery: 10,       // мин между повторными напоминаниями
    sound: true,
    notify: true,
    scale: 1,
    launchAtLogin: true,
    deathEnabled: true, // хардкор: жаба может умереть
  };

  // Пороги смерти (в долях интервала) и зона «при смерти» (доля пути до смерти)
  const DEATH_WATER = 3.0;  // waterRatio: ~2ч15м без воды при 45 мин
  const DEATH_STONE = 2.4;  // sitRatio: ~2ч сидения при 50 мин
  const CRITICAL = 0.8;
  const GRAVEYARD_MAX = 50;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dayKey = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const pick = (arr, rnd) => arr[Math.floor((rnd || Math.random)() * arr.length) % arr.length];
  const fill = (s, ctx) => s.replace(/\{(\w+)\}/g, (_, k) => (ctx && ctx[k] != null ? ctx[k] : ''));

  const PHRASES = {
    water: [
      'Я сохну быстрее, чем собирается твой билд. Стакан воды? 💧',
      'git commit -m "выпил воды" — самый лёгкий коммит за день 💧',
      'Кожа шелушится, как legacy-код. Попей водички!',
      'waterLevel === undefined. Пофиксишь? 💧',
      'Жабы на 90% вода. Ты, кстати, тоже 💧',
      'Мозгу нужна вода, чтобы ловить баги. Глоток-другой? 💧',
    ],
    waterBad: [
      'Я превращаюсь в изюм... ВОДЫ! 🥵',
      'Это уже не жаба, а сухарик. Срочно стакан воды!',
      'Error 418: I\'m a dry frog. Полей меня 💧',
    ],
    move: [
      'Ты сидишь {min} мин. Я начинаю каменеть 🗿',
      'Мои лапки уже гранитные. Встань, разомнись!',
      'Сидячий режим — это тоже техдолг. Разминка!',
      'Пора на rebase позвоночника. Встань на пару минут 🤸',
    ],
    moveBad: [
      'Всё, я памятник. Спаси меня — встань и подвигайся! 🗿',
      'Сидишь {min} мин. Меня уже можно ставить в парке.',
    ],
    exercise: [
      'Встань и потянись к потолку на 10 секунд.',
      'Покрути головой — по 5 раз в каждую сторону.',
      '10 приседаний — баги сами испугаются.',
      'Пройдись до кухни и обратно.',
      'Сведи лопатки 10 раз — спина скажет спасибо.',
      'Посмотри в окно 20 секунд — глазам тоже нужен перерыв.',
      'Покрути кистями: туннельный синдром не дремлет.',
    ],
    drink: [
      'Ммм, свежо! Стакан №{n} сегодня 💧',
      'Ква-а-а, оживаю! №{n} 💧',
      'Гидратация пройдена ✅ Стакан №{n}',
    ],
    stretch: [
      'Хрусть! Камень осыпался. Разминка №{n} 🤸',
      'Вот это я понимаю — refactoring тела! №{n}',
      'Лапки снова гнутся. Разминка №{n} 🤸',
    ],
    back: [
      'С возвращением! Перерыв {min} мин засчитан — камень осыпался 👍',
      'О, вернулся! {min} мин без стула — отлично 👍',
    ],
    morning: [
      'Доброе утро! Начнём день со стакана воды? 💧',
      'Новый день — новые баги. Но сначала вода 💧',
    ],
    poke: [
      'Ква! Работает — не трогай.',
      'У меня тоже бывает «it works on my machine».',
      'Тише, я дебажу муху 🪰',
      'Не забудь git push. И воды попить.',
      'Ква-ква === 0b10. Это всё, что я знаю о бинарке.',
      'Ты сегодня пишешь отличный код. Наверное.',
      'Сегодня: 💧 {drinks} · 🤸 {breaks} · ⌨️ {coding} мин',
      'Сегодня: 💧 {drinks} · 🤸 {breaks} · ⌨️ {coding} мин',
      'Самый долгий заход без перерыва сегодня: {maxSit} мин',
    ],
    critical_water: [
      '⚠️ Уровень воды критический. Ещё немного — и я stack trace из песка 🥵',
      'Чувствую себя как сервер без кулера. ВОДЫ, срочно!',
      'Я уже вижу свет в конце туннеля... это монитор. Дай попить!',
      'Мой HP как покрытие тестами в legacy — почти ноль. Стакан воды!',
    ],
    critical_move: [
      '⚠️ Я на 80% гранит. Ещё чуть-чуть — и меня можно деплоить в музей 🗿',
      'Лапки не гнутся, сердце в read-only. Встань, пожалуйста!',
      'Segfault в позвоночнике неизбежен. Разминка, СЕЙЧАС!',
      'Последний шанс на rollback: встань и подвигайся 🗿',
    ],
    death_dry: [
      'Жабка #{gen} засохла в изюм. Прожила {age} мин. 404: water not found 🪦',
      'Process frog exited with code DRY. Покойся с миром, #{gen} 🪦',
      'Жабка #{gen} рассыпалась песком. Последний коммит: «пить хочу» 🪦',
      'Garbage collector собрал Жабку #{gen}. Причина: обезвоживание 🪦',
    ],
    death_stone: [
      'Жабка #{gen} окаменела насмерть. Теперь она нефритовая статуэтка 🗿🪦',
      'FATAL: frog #{gen} hardened. Слишком долго сидели. Прожила {age} мин 🪦',
      'Жабка #{gen} рассыпалась на камушки. Сидячий техдолг погашен ею 🪦',
      'Жабка #{gen} стала памятником работе без перерывов 🪦',
    ],
    reborn: [
      'Ква! Я Жабка #{gen}. Hello, world! 🐣',
      'npm install frog@{gen} — успешно. Будем пить воду? 🐣',
      'Новая жаба, новый спринт. Я #{gen}, и я верю в тебя 🐣',
      'git checkout -b frog-{gen}. Начнём с чистого листа 🐣',
    ],
    paused: ['Ок, не мешаю. Пауза на {min} мин 🤫'],
    resumed: ['Я снова на посту 🐸'],
  };

  function say(kind, ctx, rnd) {
    return fill(pick(PHRASES[kind], rnd), ctx);
  }

  function newDay(t) {
    return { date: dayKey(t), drinks: 0, breaks: 0, autoBreaks: 0, maxSitMs: 0, codingMs: 0 };
  }

  function newTotals() {
    return {
      drinks: 0, breaks: 0, autoBreaks: 0, deaths: 0, deathsDry: 0, deathsStone: 0,
      codingMs: 0, maxSitMs: 0, longestLifeMin: 0, days: 1,
    };
  }

  // Итоги за всё время из истории дней (для старых сохранений без totals)
  function totalsFromDays(days) {
    const tot = newTotals();
    tot.days = Math.max(1, days.length);
    for (const d of days) {
      tot.drinks += d.drinks || 0;
      tot.breaks += d.breaks || 0;
      tot.autoBreaks += d.autoBreaks || 0;
      tot.codingMs += d.codingMs || 0;
      tot.maxSitMs = Math.max(tot.maxSitMs, d.maxSitMs || 0);
    }
    return tot;
  }

  function createPet(saved, settings, now) {
    now = now || Date.now();
    let S = Object.assign({}, DEFAULTS, settings || {});
    const st = Object.assign({
      waterMs: 0, sitMs: 0, pausedUntil: 0,
      nextNag: { water: 0, move: 0 }, nags: { water: 0, move: 0 },
      lastTick: 0, away: false, awayStart: 0, idleSec: 0,
      day: newDay(now), history: [],
      life: 'alive', cause: null, diedAt: 0, generation: 1, bornAt: now,
      crit: { water: false, move: false }, graveyard: [],
    }, saved || {});
    st.nextNag = Object.assign({ water: 0, move: 0 }, st.nextNag);
    st.nags = Object.assign({ water: 0, move: 0 }, st.nags);
    st.day = Object.assign(newDay(now), st.day);
    st.history = Array.isArray(st.history) ? st.history : [];
    st.crit = Object.assign({ water: false, move: false }, st.crit);
    st.graveyard = Array.isArray(st.graveyard) ? st.graveyard.slice(-GRAVEYARD_MAX) : [];
    if (st.life !== 'dead') st.life = 'alive';
    st.generation = Math.max(1, Number(st.generation) || 1);
    st.bornAt = Number(st.bornAt) || now;
    st.totals = Object.assign(totalsFromDays(st.history.concat([st.day])), st.totals || {});

    const every = (kind) => (kind === 'water' ? S.waterEvery : S.moveEvery) * MIN;
    const ratio = (kind) => (kind === 'water' ? st.waterMs : st.sitMs) / every(kind);
    const ctx = (extra) => Object.assign({
      drinks: st.day.drinks,
      breaks: st.day.breaks + st.day.autoBreaks,
      coding: Math.round(st.day.codingMs / MIN),
      maxSit: Math.round(Math.max(st.day.maxSitMs, st.sitMs) / MIN),
      min: Math.round(st.sitMs / MIN),
    }, extra || {});

    function rollDay(t) {
      const k = dayKey(t);
      if (st.day.date === k) return false;
      st.history.push(st.day);
      st.history = st.history.slice(-30);
      st.day = newDay(t);
      st.totals.days++;
      return true;
    }

    const dead = () => st.life === 'dead';
    const deathAt = (kind) => (kind === 'water' ? DEATH_WATER : DEATH_STONE);
    const doom = (kind) => clamp(ratio(kind) / deathAt(kind), 0, 1);
    const ageMin = (t) => Math.max(0, Math.floor(((dead() ? st.diedAt : t) - st.bornAt) / MIN));

    function endSitting() {
      st.day.maxSitMs = Math.max(st.day.maxSitMs, st.sitMs);
      st.totals.maxSitMs = Math.max(st.totals.maxSitMs, st.sitMs);
      if (dead()) return; // мёртвая жаба остаётся каменной до возрождения
      st.sitMs = 0;
      st.crit.move = false;
      st.nextNag.move = 0;
      st.nags.move = 0;
    }

    function tick(t, idleSec) {
      const events = [];
      const dt = st.lastTick ? Math.max(0, t - st.lastTick) : 0;
      st.lastTick = t;
      st.idleSec = idleSec || 0;
      const newDayStarted = rollDay(t);

      // Компьютер спал / приложение было закрыто несколько часов
      if (dt > 2 * HOUR) {
        endSitting();
        st.away = false;
        if (!dead()) {
          st.waterMs = Math.max(st.waterMs, every('water') * 0.9);
          st.nextNag.water = 0;
        }
        if (dt > 6 * HOUR || newDayStarted) {
          if (dead()) events.push(revive(t)); // утро воскрешает жабу
          events.push({ type: 'morning', text: say('morning', ctx()) });
        }
        return events;
      }

      const paused = t < st.pausedUntil;
      if (st.pausedUntil && !paused) {
        st.pausedUntil = 0;
        events.push({ type: 'resumed', text: say('resumed', ctx()) });
      }
      const idleMs = st.idleSec * SEC;
      const breakMs = S.breakAfter * MIN;

      if (!st.away && (idleMs >= breakMs || dt >= breakMs)) {
        st.away = true;
        st.awayStart = t - Math.max(idleMs, dt);
        endSitting();
      } else if (st.away && idleMs < 15 * SEC && dt < breakMs) {
        st.away = false;
        const min = Math.round((t - st.awayStart) / MIN);
        st.day.autoBreaks++;
        st.totals.autoBreaks++;
        events.push({ type: 'back', min, text: say('back', ctx({ min })) });
      }

      // Пока жаба мертва, время до смерти не тикает
      if (!paused && !dead()) {
        st.waterMs += dt;
        if (!st.away) st.sitMs += dt;
      }
      if (!st.away && idleMs < MIN) {
        st.day.codingMs += dt;
        st.totals.codingMs += dt;
      }

      // Смерть и «при смерти» — только когда человек за компом и не на паузе
      if (!paused && !st.away && !dead() && S.deathEnabled) {
        for (const kind of ['water', 'move']) {
          if (ratio(kind) >= deathAt(kind)) {
            events.push(die(t, kind === 'water' ? 'dry' : 'stone'));
            return events;
          }
        }
        for (const kind of ['water', 'move']) {
          if (doom(kind) >= CRITICAL && !st.crit[kind]) {
            st.crit[kind] = true;
            events.push({ type: 'critical', kind, text: say('critical_' + kind, ctx()) });
          }
        }
      }

      if (!paused && !st.away && !dead() && idleMs < 2 * MIN) {
        for (const kind of ['water', 'move']) {
          const r = ratio(kind);
          if (r >= 1 && t >= st.nextNag[kind]) {
            st.nextNag[kind] = t + S.nagEvery * MIN;
            st.nags[kind]++;
            const bad = r >= 1.5;
            const key = kind + (bad ? 'Bad' : '');
            const ev = { type: 'remind', kind, level: r, nag: st.nags[kind], text: say(key, ctx()) };
            if (kind === 'move') ev.tip = say('exercise', ctx());
            events.push(ev);
          }
        }
      }
      return events;
    }

    function die(t, cause) {
      st.day.maxSitMs = Math.max(st.day.maxSitMs, st.sitMs);
      st.totals.maxSitMs = Math.max(st.totals.maxSitMs, st.sitMs);
      st.life = 'dead';
      st.cause = cause;
      st.diedAt = t;
      const age = ageMin(t);
      st.totals.deaths++;
      if (cause === 'dry') st.totals.deathsDry++;
      else st.totals.deathsStone++;
      st.totals.longestLifeMin = Math.max(st.totals.longestLifeMin, age);
      st.graveyard.push({ generation: st.generation, cause, bornAt: st.bornAt, diedAt: t, ageMin: age });
      st.graveyard = st.graveyard.slice(-GRAVEYARD_MAX);
      const text = say(cause === 'dry' ? 'death_dry' : 'death_stone', ctx({ gen: st.generation, age }));
      return { type: 'death', cause, generation: st.generation, ageMin: age, text };
    }

    // Новая жаба: следующее поколение, счётчики воды и сидения с нуля
    function revive(t) {
      t = t || Date.now();
      rollDay(t);
      if (!dead()) st.totals.longestLifeMin = Math.max(st.totals.longestLifeMin, ageMin(t));
      st.day.maxSitMs = Math.max(st.day.maxSitMs, st.sitMs);
      st.totals.maxSitMs = Math.max(st.totals.maxSitMs, st.sitMs);
      st.life = 'alive';
      st.cause = null;
      st.diedAt = 0;
      st.generation++;
      st.bornAt = t;
      st.waterMs = 0;
      st.sitMs = 0;
      st.nextNag = { water: 0, move: 0 };
      st.nags = { water: 0, move: 0 };
      st.crit = { water: false, move: false };
      return { type: 'reborn', generation: st.generation, text: say('reborn', ctx({ gen: st.generation })) };
    }

    function drink(t) {
      t = t || Date.now();
      rollDay(t);
      if (!dead()) {
        st.waterMs = 0;
        st.nextNag.water = 0;
        st.nags.water = 0;
        st.crit.water = false;
      }
      st.day.drinks++;
      st.totals.drinks++;
      return { type: 'drink', n: st.day.drinks, text: say('drink', ctx({ n: st.day.drinks })) };
    }

    function stretch(t) {
      t = t || Date.now();
      rollDay(t);
      endSitting();
      st.day.breaks++;
      st.totals.breaks++;
      return { type: 'stretch', n: st.day.breaks, text: say('stretch', ctx({ n: st.day.breaks })) };
    }

    function snooze(kind, t, minutes) {
      st.nextNag[kind] = (t || Date.now()) + (minutes || S.nagEvery) * MIN;
    }

    function pause(t, minutes) {
      st.pausedUntil = minutes ? t + minutes * MIN : 0;
      return minutes ? { type: 'paused', min: minutes, text: say('paused', ctx({ min: minutes })) }
                     : { type: 'resumed', text: say('resumed', ctx()) };
    }

    function poke() {
      return { type: 'poke', text: say('poke', ctx()) };
    }

    function view(t) {
      t = t || Date.now();
      const wr = ratio('water'), sr = ratio('move');
      const idle = st.idleSec;
      const age = ageMin(t);
      const crit = !dead() && S.deathEnabled;
      return {
        glass: clamp(1 - wr, 0, 1),
        dry: clamp((wr - 0.6) / 1.2, 0, 1),
        stone: clamp((sr - 0.45) / 1.15, 0, 1),
        waterRatio: wr,
        sitRatio: sr,
        waterLeftMin: Math.max(0, Math.ceil((every('water') - st.waterMs) / MIN)),
        moveLeftMin: Math.max(0, Math.ceil((every('move') - st.sitMs) / MIN)),
        sitMin: Math.floor(st.sitMs / MIN),
        activity: st.away ? 'away' : idle < 4 ? 'coding' : idle < 60 ? 'thinking' : 'idle',
        paused: t < st.pausedUntil,
        pausedLeftMin: Math.max(0, Math.ceil((st.pausedUntil - t) / MIN)),
        needs: { water: !dead() && wr >= 1, move: !dead() && sr >= 1 },
        day: ctx(),
        life: st.life,
        cause: st.cause,
        diedAt: st.diedAt,
        generation: st.generation,
        bornAt: st.bornAt,
        ageMin: age,
        doom: { water: doom('water'), move: doom('move') },
        critical: {
          water: crit && doom('water') >= CRITICAL,
          move: crit && doom('move') >= CRITICAL,
        },
        totals: Object.assign({}, st.totals, {
          maxSitMs: Math.max(st.totals.maxSitMs, st.sitMs),
          longestLifeMin: Math.max(st.totals.longestLifeMin, age),
        }),
        graveyardCount: st.graveyard.length,
      };
    }

    return {
      tick, drink, stretch, snooze, pause, poke, view, revive,
      graveyard() { return JSON.parse(JSON.stringify(st.graveyard)); },
      setSettings(s) { S = Object.assign({}, DEFAULTS, s); },
      serialize() { return JSON.parse(JSON.stringify(st)); },
      get state() { return st; },
    };
  }

  return { createPet, say, DEFAULTS, PHRASES, MIN, HOUR, dayKey, DEATH_WATER, DEATH_STONE, CRITICAL };
});
