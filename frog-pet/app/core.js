// Логика жабы: таймеры воды и движения, напоминания, статистика.
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
  };

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
    paused: ['Ок, не мешаю. Пауза на {min} мин 🤫'],
    resumed: ['Я снова на посту 🐸'],
  };

  function say(kind, ctx, rnd) {
    return fill(pick(PHRASES[kind], rnd), ctx);
  }

  function newDay(t) {
    return { date: dayKey(t), drinks: 0, breaks: 0, autoBreaks: 0, maxSitMs: 0, codingMs: 0 };
  }

  function createPet(saved, settings, now) {
    now = now || Date.now();
    let S = Object.assign({}, DEFAULTS, settings || {});
    const st = Object.assign({
      waterMs: 0, sitMs: 0, pausedUntil: 0,
      nextNag: { water: 0, move: 0 }, nags: { water: 0, move: 0 },
      lastTick: 0, away: false, awayStart: 0, idleSec: 0,
      day: newDay(now), history: [],
    }, saved || {});
    st.nextNag = Object.assign({ water: 0, move: 0 }, st.nextNag);
    st.nags = Object.assign({ water: 0, move: 0 }, st.nags);
    st.day = Object.assign(newDay(now), st.day);

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
      return true;
    }

    function endSitting() {
      st.day.maxSitMs = Math.max(st.day.maxSitMs, st.sitMs);
      st.sitMs = 0;
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
        st.waterMs = Math.max(st.waterMs, every('water') * 0.9);
        st.nextNag.water = 0;
        if (dt > 6 * HOUR || newDayStarted) events.push({ type: 'morning', text: say('morning', ctx()) });
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
        events.push({ type: 'back', min, text: say('back', ctx({ min })) });
      }

      if (!paused) {
        st.waterMs += dt;
        if (!st.away) st.sitMs += dt;
      }
      if (!st.away && idleMs < MIN) st.day.codingMs += dt;

      if (!paused && !st.away && idleMs < 2 * MIN) {
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

    function drink(t) {
      t = t || Date.now();
      rollDay(t);
      st.waterMs = 0;
      st.nextNag.water = 0;
      st.nags.water = 0;
      st.day.drinks++;
      return { type: 'drink', n: st.day.drinks, text: say('drink', ctx({ n: st.day.drinks })) };
    }

    function stretch(t) {
      t = t || Date.now();
      rollDay(t);
      endSitting();
      st.day.breaks++;
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
        needs: { water: wr >= 1, move: sr >= 1 },
        day: ctx(),
      };
    }

    return {
      tick, drink, stretch, snooze, pause, poke, view,
      setSettings(s) { S = Object.assign({}, DEFAULTS, s); },
      serialize() { return JSON.parse(JSON.stringify(st)); },
      get state() { return st; },
    };
  }

  return { createPet, say, DEFAULTS, PHRASES, MIN, HOUR, dayKey };
});
