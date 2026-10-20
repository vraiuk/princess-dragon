// Режим съёмки: сценарии для шортсов и демо + «режиссёр», который их проигрывает.
// Режиссёр только двигает симулированное время и жмёт действия через ctl —
// смерть, возрождение и ачивки случаются сами в core/achievements.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrogShowcase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FF_DT = 0.15;   // с между порциями перемотки — трансформация видна глазом
  // «удержание» второй потребности во время перемотки: тихо пьём/разминаемся,
  // чтобы, например, засыхание не смешивалось с окаменением
  const HOLD = {
    move: { action: 'stretch', every: 15 },   // разминка каждые 15 сим. мин (камень начинается с ~22)
    water: { action: 'drink', every: 12 },    // глоток каждые 12 сим. мин (сухость начинается с ~27)
  };

  // Конструкторы шагов
  const reset = (t) => ({ t, cmd: 'reset' });
  const ff = (t, minutes, over, extra) => Object.assign({ t, cmd: 'ff', minutes, over, idleSec: 1 }, extra);
  const act = (t, type, opts) => ({ t, cmd: 'action', type, opts: opts || {} });
  const say = (t, text) => ({ t, cmd: 'say', text });
  const cap = (t, text) => ({ t, cmd: 'caption', text });   // титр поверх сцены (если ctl.caption есть)

  // Тайминги анимаций death.js (секунды от события): смерть → надгробие поднялось
  // (T_*.tomb + TOMB_RISE) и revive → жаба вылупилась. test/showcase.test.js сверяет их
  // с death.js — если анимацию удлинят, тест упадёт, и сценарии надо будет сдвинуть.
  // Замер по кадрам 9:16 (круг 2): надгробие поднято через 6.3 с (dry) и 6.5 с (stone);
  // приветствие появляется через 5.8–6.8 с после revive (pet.js реже рисует в покое).
  const TIMING = {
    tomb: { dry: 6.3, stone: 6.5 },   // смерть → надгробие целиком (T_*.tomb + TOMB_RISE)
    rip: { dry: 7.1, stone: 7.3 },    // смерть → облачко RIP с кнопкой «🥚 Новая жаба» (pet.js ждёт 0.8 с);
                                      // под тостами ачивок облачко ждёт их конца (~8.3 с при двух тостах)
    tombHold: 2.5,                    // облачко RIP и надгробие в кадре не меньше, с
    hatch: 6.8,                       // revive → жаба вылупилась и здоровается (с запасом)
  };
  // Сколько текст должен провисеть, чтобы его прочли: ≥ 2 с на 10 слов, но не меньше 2 с
  const words = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const readSec = (s) => Math.max(2, words(s) * 0.2);

  // Фиксированные реплики на съёмке: core выбирает фразы случайно, а для субтитров
  // и озвучки нужен один и тот же текст в каждом дубле. Ключ — type:kind|cause или type;
  // массив — по очереди для повторов; ':tip' — подсказка под текстом.
  const LINES = {
    'remind:water': 'Стакан пуст. Попей водички, пока я не засохла 💧',
    'remind:move': 'Сидим уже 50 минут. Я начинаю каменеть 🗿',
    'remind:move:tip': 'Встань и потянись: руки вверх на 10 секунд.',
    'critical:water': 'ВОДЫ! Я сохну быстрее, чем твой билд 🥵',
    'critical:move': 'Я почти гранит. Встань, пожалуйста! 🗿',
    'death:dry': 'Жабка #{gen} засохла в изюм. 404: water not found 🪦',
    'death:stone': 'FATAL: frog #{gen} hardened. Ты слишком долго сидишь 🪦',
    reborn: 'Ква! Я Жабка #{gen}. Hello, world! 🐣',
    drink: 'Глоток! Вода — лучший рефакторинг 💧',
    stretch: 'Хруст! Позвоночник смёржен без конфликтов 🤸',
    back: 'С возвращением! Перерыв {min} мин засчитан 👍',
    poke: ['Ква! Не отвлекай, у меня компиляция 🐸', 'Тык принят. Ачивки за тыки тоже есть 👉', 'Ква! До встречи на рабочем столе 🐸'],
  };

  // Пороги (DEFAULTS: вода 45 мин, разминка 50 мин):
  //  вода: напоминание 45, critical 108 (0.8×3.0×45), смерть 135
  //  сидение: напоминание 50, critical 96 (0.8×2.4×50), смерть 120
  // Правила монтажа (их проверяет test/showcase.test.js):
  //  - напоминание и «при смерти» висят ≥ readSec, их ничто не перебивает;
  //  - revive не раньше, чем надгробие провисит TIMING.tombHold;
  //  - пока жаба в яйце и здоровается — никаких шагов, кроме титров;
  //  - в кадре только ачивки из achievements (белый список).
  const SCRIPTS = {
    short: {
      title: 'Шортс: жаба умирает дважды',
      ratio: '9:16',
      duration: 80,
      achievements: ['raisin', 'jade', 'iron_butt'],
      steps: [
        reset(0),
        cap(0.2, 'Жаба умрёт, если я не пью и не встаю 💀'),
        say(0.6, 'Кодим! Вода? После деплоя.'),
        ff(1.4, 46, 3.4, { hold: 'move' }),             // напоминание о воде на ~4.7 с
        act(7.4, 'snooze', { kind: 'water', minutes: 120 }),
        say(7.5, 'Позже. Я сеньор 😎'),
        cap(7.8, 'игнорирую 🙈'),
        ff(10.0, 62, 4, { hold: 'move' }),              // засыхание → «при смерти» на ~14 с: вернувшееся напоминание успевает провисеть 2 с
        cap(15.7, 'Жаба при смерти 🥵'),                // без чисел: счётчик HUD рядом (r3-04-03)
        ff(16.6, 28, 2, { hold: 'move' }),              // смерть на ~18.4 с: изюм → песок, тост «Изюм»
        cap(22.6, 'Ctrl+Z для жабы? 🥚'),                // сразу после тоста «Изюм»
        act(28.4, 'revive'),                            // облачко RIP с 25.5 с, яйцо → жаба к ~35
        cap(31.0, 'Жабка #2. А теперь не встаю 🪑'),
        say(37.4, 'Воду пью! А встать? Не, я в потоке 🎧'),
        ff(39.4, 51, 3.4, { hold: 'water' }),           // напоминание о разминке на ~42.7 с
        act(45.8, 'snooze', { kind: 'move', minutes: 120 }),
        cap(44.0, 'Каменеет снизу вверх 🗿'),
        say(45.9, 'Встать? У меня дедлайн 🗿'),
        ff(47.0, 45, 2.2, { hold: 'water' }),           // «при смерти» на ~49.1 с — раньше, чем вернётся напоминание
        cap(51.0, 'Жаба при смерти 🗿'),
        ff(53.2, 25, 2, { hold: 'water' }),             // смерть на ~55 с: трещины → камушки → пыль, два тоста
        cap(63.2, 'Жабка #3? 🥚'),
        act(66.1, 'revive'),                            // облачко RIP после двух тостов ~63.3 с, жаба к ~72.4
        cap(72.9, 'Встань. Попей. Спаси жабу 🐸'),
        act(75.0, 'drink'),
        cap(75.7, 'Жабка для macOS. Ссылка в профиле'),
      ],
    },

    water: {
      title: 'Засыхание',
      ratio: '9:16',
      duration: 40,
      achievements: ['raisin'],
      steps: [
        reset(0),
        cap(0.2, 'Что будет, если не пить воду 💧'),
        say(0.6, 'git commit -m "попью потом"'),
        ff(1.4, 46, 3.4, { hold: 'move' }),             // напоминание на ~4.7 с
        act(7.4, 'snooze', { kind: 'water', minutes: 120 }),
        say(7.5, 'Позже. Ещё один тикет.'),
        cap(7.8, 'не пью воду. Вообще 🚱'),
        ff(10.0, 62, 4, { hold: 'move' }),              // «при смерти» на ~14 с
        cap(15.7, 'Жаба при смерти 🥵'),
        ff(16.6, 28, 2, { hold: 'move' }),              // смерть на ~18.4 с, тост «Изюм»
        cap(22.6, 'Она просила пить каждые 45 минут'),
        act(28.4, 'revive'),                            // облачко RIP с 25.5 с, жаба к ~35
        cap(35.2, 'Жабка для macOS. Попей воды 💧'),
        act(37.4, 'drink'),
      ],
    },

    stone: {
      title: 'Окаменение',
      ratio: '9:16',
      duration: 42,
      achievements: ['jade', 'iron_butt'],
      steps: [
        reset(0),
        cap(0.2, 'Что будет, если не вставать 2 часа 🪑'),
        say(0.6, 'Ещё один фикс — и встану. Честно.'),
        ff(1.4, 51, 3.4, { hold: 'water' }),            // напоминание на ~4.7 с
        act(7.6, 'snooze', { kind: 'move', minutes: 120 }),
        say(7.7, 'Встану после код-ревью 🗿'),
        cap(7.9, 'не встаю. Совсем 🪑'),
        ff(10.6, 45, 3.6, { hold: 'water' }),           // «при смерти» на ~14 с
        cap(14.6, 'Жаба при смерти 🪨'),                 // FATAL скажет облачко RIP после смерти
        ff(16.6, 24.5, 2.4, { hold: 'water' }),         // смерть на ~18.9 с, тосты «Железножопая» и «Нефритовая»
        cap(27.0, 'Встань раз в 50 минут — жаба заметит'),
        act(30.0, 'revive'),                            // облачко RIP после двух тостов ~27.2 с, жаба к ~37
        cap(36.7, 'Жабка для macOS. Встань и разомнись 🐸'),
        act(38.9, 'stretch'),
      ],
    },

    tour: {
      title: 'Демо-тур для YouTube',
      duration: 116,
      achievements: ['raisin', 'jade', 'iron_butt'],
      steps: [
        reset(0),
        cap(0.2, 'Питомец-программист для macOS 🐸'),
        say(0.8, 'Привет! Я живу у тебя на рабочем столе и пишу код вместе с тобой.'),
        act(4.6, 'poke'),
        cap(7.4, 'Стакан пустеет за 45 минут 💧'),
        ff(7.8, 46, 3.6, { hold: 'move' }),             // напоминание о воде на ~11.3 с
        act(14.0, 'drink'),
        cap(16.4, '50 минут сидения — и жаба каменеет 🗿'),
        ff(16.6, 51, 3.6, { hold: 'water' }),           // напоминание о разминке на ~20 с
        act(23.4, 'stretch'),
        cap(25.8, 'Отошёл на 6 минут — перерыв засчитан 🚶'),
        ff(26.0, 6, 1.2, { away: true }),               // ушёл: простой растёт вместе со временем
        ff(27.4, 0.5, 0.15, { idleSec: 1 }),            // вернулся → «С возвращением! Перерыв 6 мин»
        cap(30.4, 'Ачивки, в том числе позорные 🏆'),
        act(30.8, 'poke'),
        act(33.2, 'openTrophies'),
        cap(36.4, 'Хардкор: без воды жаба умирает 💀'),
        act(36.5, 'drink', { silent: true }),           // стакан с нуля: одно напоминание, а не два
        ff(36.6, 46, 3, { hold: 'move' }),              // напоминание о воде на ~39.5 с
        act(42.0, 'snooze', { kind: 'water', minutes: 120 }),
        ff(42.2, 62, 3.6, { hold: 'move' }),            // «при смерти» на ~45.8 с
        cap(46.0, 'Игнорирую — жаба при смерти 🥵'),
        ff(48.8, 28, 2, { hold: 'move' }),              // смерть на ~50.6 с
        cap(57.0, 'Надгробие, кладбище и новое яйцо 🥚'),
        act(60.6, 'revive'),                            // облачко RIP с 57.7 с, жаба к ~66.8
        cap(70.0, 'Если сидеть 2 часа — окаменеет 🪨'),
        ff(70.2, 51, 3, { hold: 'water' }),             // напоминание о разминке на ~73 с
        act(76.2, 'snooze', { kind: 'move', minutes: 120 }),
        ff(76.4, 45, 3, { hold: 'water' }),             // «при смерти» на ~79.3 с
        cap(79.5, 'Трещины. Жаба при смерти 🗿'),
        ff(82.2, 25, 2, { hold: 'water' }),             // смерть на ~84 с
        cap(93.0, 'Жабка #3? Нажми на яйцо 🥚'),          // после двух тостов (до ~92.2 с)
        act(95.1, 'revive'),                            // облачко RIP после двух тостов ~92.3 с, жаба к ~101.3
        cap(100.0, 'Новая жаба — новый спринт 🐣'),
        act(105.5, 'drink'),
        cap(107.9, 'Тайминги и хардкор — в настройках ⚙️'),
        act(108.1, 'openSettings'),
        cap(111.1, 'Бесплатно. Ссылка в описании 🐸'),
        say(111.3, 'Пей воду, вставай со стула — и я проживу долго. Ква!'),
        act(113.7, 'poke'),
      ],
    },
  };

  // Разворачивает сценарий в плоскую ленту элементарных шагов { at, cmd, ... }.
  // ff с over > 0 превращается в серию мелких ff каждые FF_DT секунд.
  function expand(script) {
    const out = [];
    const steps = (script && script.steps) || [];
    steps.forEach((s, idx) => {
      if (s.cmd === 'ff' && s.over > 0) {
        const n = Math.max(1, Math.round(s.over / FF_DT));
        const per = s.minutes / n;
        for (let i = 0; i < n; i++) {
          out.push({ at: s.t + i * FF_DT, cmd: 'ff', minutes: per, idleSec: s.idleSec, hold: s.hold || null, away: !!s.away, idx, ord: out.length });
        }
      } else {
        out.push(Object.assign({}, s, { at: s.t, idx, ord: out.length }));
      }
    });
    out.sort((a, b) => a.at - b.at || a.ord - b.ord);
    return out;
  }

  // Выполняет один элементарный шаг. mem — память удержаний между шагами
  function run(step, ctl, mem) {
    switch (step.cmd) {
      case 'reset':
        mem.hold = {};
        return ctl.reset();
      case 'ff': {
        // «отошёл от компа»: простой растёт вместе с симулированным временем (по 20 с),
        // чтобы core засчитал перерыв с настоящего начала, а не «простой 10 мин» сразу
        if (step.away) {
          let left = step.minutes;
          while (left > 1e-9) {
            const part = Math.min(left, 1 / 3);
            mem.idle = (mem.idle || 0) + part * 60;
            ctl.ff(part, mem.idle);
            left -= part;
          }
          return;
        }
        mem.idle = 0;
        const h = step.hold && HOLD[step.hold];
        if (!h) return ctl.ff(step.minutes, step.idleSec);
        let left = step.minutes;
        let acc = mem.hold[step.hold] || 0;
        while (left > 1e-9) {
          const part = Math.min(left, h.every - acc);
          ctl.ff(part, step.idleSec);
          left -= part; acc += part;
          if (acc >= h.every - 1e-9) { ctl.action(h.action, { silent: true }); acc = 0; }
        }
        mem.hold[step.hold] = acc;
        return;
      }
      case 'action': return ctl.action(step.type, step.opts || {});
      case 'say': return ctl.say(step.text);
      case 'event': return ctl.event(step.ev || step.event);
      case 'caption': return ctl.caption ? ctl.caption(step.text) : undefined;
    }
  }

  // Тихое удержание для ctl.action(type, { silent: true }): обнуляет счётчик воды/сидения
  // прямо в состоянии core, без событий, статистики и ачивок (иначе посреди засыхания
  // всплывёт «Hello, body!»). Мёртвую жабу не трогает.
  function quiet(pet, type) {
    const st = pet && pet.state;
    if (!st || st.life === 'dead') return false;
    const kind = type === 'drink' ? 'water' : type === 'stretch' ? 'move' : null;
    if (!kind) return false;
    if (kind === 'water') st.waterMs = 0; else st.sitMs = 0;
    if (st.nextNag) st.nextNag[kind] = 0;
    if (st.nags) st.nags[kind] = 0;
    if (st.crit) st.crit[kind] = false;
    return true;
  }

  // Ачивки, зависящие от реальных часов съёмки (симулированное время стартует с «сейчас»):
  // ночью или в пятницу вечером они всплыли бы посреди дубля
  const CLOCK_BOUND = ['night', 'early_bird', 'friday', 'leet'];

  // Показывать ли тост ачивки во время сценария (script.achievements — белый список id)
  function showAchievement(script, a) {
    const only = script && script.achievements;
    if (Array.isArray(only)) return !!(a && only.indexOf(a.id) >= 0);
    return !(a && CLOCK_BOUND.indexOf(a.id) >= 0);
  }

  // Подменяет случайную фразу core фиксированной (script.lines поверх LINES).
  // seen — счётчик повторов по ключу, чтобы массивы шли по очереди
  function line(script, ev, seen) {
    if (!ev || !ev.type) return ev;
    const L = Object.assign({}, LINES, (script && script.lines) || {});
    const sub = ev.kind || ev.cause;
    const key = sub && L[ev.type + ':' + sub] != null ? ev.type + ':' + sub : ev.type;
    const ctx = { gen: ev.generation, min: ev.min, n: ev.n };
    const fill = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? ctx[k] : ''));
    const v = L[key];
    if (v != null && ev.text != null) {
      let s = v;
      if (Array.isArray(v)) {
        const n = seen ? (seen[key] = (seen[key] || 0) + 1) - 1 : 0;
        s = v[n % v.length];
      }
      ev.text = fill(s);
    }
    if (ev.tip != null && L[key + ':tip'] != null) ev.tip = fill(L[key + ':tip']);
    return ev;
  }

  // ctl: { reset, ff(minutes, idleSec), action(type, opts), say(text), event(ev), caption?(text) }
  // opts.timers — подмена setTimeout/clearTimeout/now (для тестов)
  function createDirector(script, ctl, opts) {
    const tm = (opts && opts.timers) || {
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (id) => clearTimeout(id),
      now: () => Date.now(),
    };
    const now = tm.now || (() => Date.now());
    const tape = expand(script);
    const duration = (script && script.duration) || (tape.length ? tape[tape.length - 1].at + 1 : 0);
    const ends = [];
    const mem = { hold: {} };
    const seen = {};
    let i = 0, t0 = 0, timer = null, running = false, done = false;

    function finish(reason) {
      if (done) return;
      done = true; running = false;
      if (timer != null) tm.clearTimeout(timer);
      timer = null;
      ends.forEach((cb) => { try { cb(reason); } catch (e) { console.error('showcase onEnd', e); } });
    }

    function pump() {
      timer = null;
      if (!running) return;
      const el = (now() - t0) / 1000;
      // выполняем всё, что уже наступило (если вкладка тормозила — догоняем)
      while (i < tape.length && tape[i].at <= el + 0.001) {
        try { run(tape[i], ctl, mem); } catch (e) { console.error('showcase step', tape[i], e); }
        i++;
        if (!running) return;
      }
      const next = i < tape.length ? tape[i].at : duration;
      if (i >= tape.length && el >= duration) return finish('end');
      timer = tm.setTimeout(pump, Math.max(0, (next - el) * 1000));
    }

    return {
      script, tape, duration,
      start() {
        if (running || done) return;
        running = true;
        t0 = now();
        pump();
      },
      // stop() тоже вызывает onEnd (reason = 'stop'), чтобы хозяин вернул обычный режим
      stop() { if (!done) finish('stop'); },
      onEnd(cb) { if (typeof cb === 'function') ends.push(cb); },
      get running() { return running; },
      get elapsed() { return running ? (now() - t0) / 1000 : 0; },
      // фиксированный текст события на съёмке (ctl вызывает до показа): ev.text/ev.tip заменяются
      line(ev) { return line(script, ev, seen); },
    };
  }

  return { SCRIPTS, LINES, TIMING, createDirector, expand, run, quiet, showAchievement, line, readSec, words, HOLD, FF_DT, CLOCK_BOUND };
});
