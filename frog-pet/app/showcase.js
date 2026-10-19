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

  // Пороги (DEFAULTS: вода 45 мин, разминка 50 мин):
  //  вода: напоминание 45, critical 108 (0.8×3.0×45), смерть 135
  //  сидение: напоминание 50, critical 96 (0.8×2.4×50), смерть 120
  const SCRIPTS = {
    short: {
      title: 'Шортс: жаба умирает дважды (~58 с)',
      ratio: '9:16',
      duration: 58,
      steps: [
        reset(0),
        cap(0.2, 'Моя жаба умирает, если я не пью воду 💀'),
        say(0.6, 'Кодим! Вода? После деплоя.'),
        ff(1.8, 46, 4.6, { hold: 'move' }),             // стакан пустеет → напоминание на ~6.3 с
        say(7.2, 'Напоминание? Свайп. Я сеньор 😎'),
        act(7.4, 'snooze', { kind: 'water', minutes: 120 }),
        cap(8.6, 'прошёл час...'),
        ff(8.8, 62, 5.2, { hold: 'move' }),             // засыхание → critical на ~13.9 с
        ff(16.6, 28, 2.4, { hold: 'move' }),            // смерть на ~19 с: изюм → пыль
        cap(19.4, '...и ачивка «Изюм» 🍇'),
        cap(25.4, 'Ctrl+Z для жабы? 🥚'),
        act(26.0, 'revive'),
        say(29.6, 'Воду пью! А встать? Не, я в потоке 🎧'),
        cap(30.4, 'теперь сидим 2 часа не вставая 🪑'),
        ff(31.0, 51, 3.6, { hold: 'water' }),           // напоминание о разминке на ~34.5 с
        act(34.8, 'snooze', { kind: 'move', minutes: 120 }),
        say(35.0, 'Встать? У меня ж дедлайн 🗿'),
        ff(36.4, 45, 2.8, { hold: 'water' }),           // critical на ~39.2 с
        ff(39.6, 25, 2.6, { hold: 'water' }),           // смерть на ~42.1 с: трещины → камушки → пыль
        cap(42.6, 'рассыпалась на камушки 🪨'),
        cap(46.0, '+ «Нефритовая жаба» и «Железножопая жаба» 🏆'),
        act(49.0, 'revive'),
        act(51.8, 'drink'),
        cap(53.4, 'Жабка для macOS. Попей воды 💧'),
        say(55.4, 'Вода — лучший рефакторинг 💧🐸'),
      ],
    },

    water: {
      title: 'Засыхание (~28 с)',
      duration: 28,
      steps: [
        reset(0),
        cap(0.2, 'Что будет, если не пить воду 💧'),
        say(0.6, 'git commit -m "попью потом"'),
        ff(1.6, 46, 4, { hold: 'move' }),               // напоминание на ~5.6 с
        act(6.8, 'snooze', { kind: 'water', minutes: 120 }),
        say(7.0, 'Позже. Ещё один тикет.'),
        ff(8.2, 62.5, 4.8, { hold: 'move' }),           // critical на ~13 с
        ff(14.4, 27.5, 3, { hold: 'move' }),            // смерть на ~17.3 с
        cap(17.6, '404: water not found 🍇'),
        act(23.0, 'revive'),
        act(25.4, 'drink'),
      ],
    },

    stone: {
      title: 'Окаменение (~26 с)',
      duration: 26,
      steps: [
        reset(0),
        cap(0.2, 'Что будет, если не вставать 2 часа 🪑'),
        say(0.6, 'Ещё один фикс — и встану. Честно.'),
        ff(1.6, 51, 4, { hold: 'water' }),              // напоминание на ~5.6 с
        act(6.8, 'snooze', { kind: 'move', minutes: 120 }),
        say(7.0, 'Встану после код-ревью 🗿'),
        ff(8.2, 45.5, 3.6, { hold: 'water' }),          // critical на ~11.7 с
        ff(13.0, 24.5, 2.4, { hold: 'water' }),         // смерть на ~15.3 с
        cap(15.2, 'FATAL: frog hardened 🗿'),
        act(21.6, 'revive'),
        act(24.4, 'stretch'),
      ],
    },

    tour: {
      title: 'Демо-тур для YouTube (~92 с)',
      duration: 92,
      steps: [
        reset(0),
        cap(0.2, 'Жабка — питомец-программист для macOS 🐸'),
        say(0.8, 'Привет! Я живу у тебя на рабочем столе и кодю вместе с тобой.'),
        act(4.6, 'poke'),
        cap(7.4, 'Стакан пустеет за 45 минут 💧'),
        ff(7.8, 46, 3.6, { hold: 'move' }),             // напоминание о воде
        act(12.6, 'drink'),
        cap(15.4, '50 минут сидения — и жаба каменеет 🗿'),
        ff(15.8, 51, 3.6, { hold: 'water' }),           // напоминание о разминке
        act(20.6, 'stretch'),
        cap(23.6, 'Отошёл от компа на 5 минут — перерыв засчитан сам 🚶'),
        ff(24.0, 7, 1.2, { idleSec: 600 }),             // ушёл
        ff(26.4, 0.5, 0.15, { idleSec: 1 }),            // вернулся → «С возвращением!»
        cap(30.0, 'Ачивки: хорошие, позорные и секретные 🏆'),
        act(30.6, 'poke'),
        act(32.0, 'openTrophies'),
        cap(36.0, 'Хардкор: без воды жаба засыхает насмерть 💀'),
        ff(36.4, 46, 3, { hold: 'move' }),
        act(38.9, 'snooze', { kind: 'water', minutes: 120 }),
        ff(40.0, 90, 5.2, { hold: 'move' }),            // critical, затем смерть на ~45 с
        act(51.0, 'revive'),
        cap(54.2, 'А если сидеть 2 часа — рассыпается на камушки 🪨'),
        ff(54.6, 51, 3, { hold: 'water' }),
        act(57.8, 'snooze', { kind: 'move', minutes: 120 }),
        ff(58.2, 71, 4.6, { hold: 'water' }),           // critical, смерть на ~62.6 с
        act(69.4, 'revive'),
        act(72.4, 'drink'),
        cap(75.0, 'Все тайминги и хардкор — в настройках ⚙️'),
        act(75.6, 'openSettings'),
        cap(80.6, 'Бесплатно. Ссылка в описании 🐸'),
        say(81.2, 'Пей воду, вставай со стула — и я проживу долго. Ква!'),
        act(86.0, 'poke'),
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
          out.push({ at: s.t + i * FF_DT, cmd: 'ff', minutes: per, idleSec: s.idleSec, hold: s.hold || null, idx, ord: out.length });
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
    };
  }

  return { SCRIPTS, createDirector, expand, run, quiet, HOLD, FF_DT };
});
