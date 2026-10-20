// Ачивки жабы: хорошие, позорные и секретные.
// Чистый модуль без зависимостей — работает и в Electron (main), и в браузерном демо.
// check() вызывается каждый тик, поэтому всё дешёвое: проверяются только не полученные ачивки,
// тяжёлое (серии дней) кешируется.
//
// Секретные (kind: 'secret') до получения в list() отдаются замаскированными:
// hidden: true, title '???', desc-подсказка, icon '❓', progress: null.
// После получения hidden: false и видно настоящее название.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrogAchievements = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEC = 1000, MIN = 60 * SEC;
  const DAY_MIN = 24 * 60;

  // Пороги смерти и настройки по умолчанию — как в core.js (DEATH_WATER, DEATH_STONE, DEFAULTS);
  // модуль без зависимостей, поэтому копия, а test/achievements.test.js сверяет её с core
  const DEATH_WATER = 3.0, DEATH_STONE = 2.4;
  const DEF_SET = { waterEvery: 45, moveEvery: 50, deathEnabled: true };
  const IRON_MIN = 120, IRON_SHARE = 0.9, SPEEDRUN_MIN = 180;
  const interval = (set, k) => (typeof set[k] === 'number' && isFinite(set[k]) && set[k] > 0 ? set[k] : DEF_SET[k]);
  // «Железножопая жаба»: 2 часа, но не дольше 90% пути до каменной смерти — иначе в хардкоре
  // при коротком интервале разминки жаба окаменеет раньше, чем ачивка станет возможной
  function ironMin(set) {
    set = set && typeof set === 'object' ? set : {};
    if (set.deathEnabled === false) return IRON_MIN;
    return Math.min(IRON_MIN, IRON_SHARE * DEATH_STONE * interval(set, 'moveEvery'));
  }

  const dayKey = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const keyToNum = (k) => {
    const p = String(k || '').split('-').map(Number);
    return p.length === 3 ? Math.round(new Date(p[0], p[1] - 1, p[2]).getTime() / 86400000) : NaN;
  };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const hasEv = (c, type, pred) => c.events.some((e) => e && e.type === type && (!pred || pred(e)));

  // «Хороший день»: ≥6 стаканов и ≥4 перерыва
  const goodDay = (d) => d && num(d.drinks) >= 6 && num(d.breaks) + num(d.autoBreaks) >= 4;

  // test(c) -> bool, либо cur(c) -> число при заданном max
  const DEFS = [
    // ---------- хорошие ----------
    { id: 'first_drink', kind: 'good', rarity: 'common', icon: '💧', title: 'Первый глоток',
      desc: 'Hello, water! Первый стакан выпит.', test: (c) => c.drinksTotal >= 1 },
    { id: 'hydrated', kind: 'good', rarity: 'rare', icon: '🚰', title: 'Гидратированный разработчик',
      desc: '8 стаканов за день. Почки сделали апрув.', max: 8, cur: (c) => c.day.drinks },
    { id: 'aquarium', kind: 'good', rarity: 'epic', icon: '🐠', title: 'Аквариум',
      desc: '100 стаканов всего. Ты уже наполовину жаба.', max: 100, cur: (c) => c.drinksTotal },
    { id: 'answer42', kind: 'secret', rarity: 'rare', icon: '🌌', title: 'Ответ на главный вопрос',
      desc: '42 стакана. Не паникуй, возьми полотенце.', test: (c) => c.drinksTotal >= 42 },
    { id: 'first_stretch', kind: 'good', rarity: 'common', icon: '🤸', title: 'Hello, body!',
      desc: 'Первая разминка. Оказывается, у тебя есть спина.', test: (c) => c.stretchTotal >= 1 },
    { id: 'stretch10', kind: 'good', rarity: 'epic', icon: '🧘', title: 'Рефакторинг позвоночника',
      desc: '10 разминок за день. Позвонки отсортированы.', max: 10, cur: (c) => c.day.stretches },
    { id: 'stretch100', kind: 'good', rarity: 'epic', icon: '🥋', title: 'Йога-ниндзя',
      desc: '100 перерывов всего. Стул тебя почти не помнит.', max: 100, cur: (c) => c.breaksTotal },
    { id: 'graceful', kind: 'good', rarity: 'common', icon: '🚶', title: 'Graceful shutdown',
      desc: 'Сам ушёл от компа на перерыв. Без SIGKILL.', test: (c) => hasEv(c, 'back') },
    { id: 'early_bird', kind: 'good', rarity: 'common', icon: '🌅', title: 'Ранний коммит',
      desc: 'Стакан воды до 9 утра. Кофе подождёт.',
      test: (c) => c.hour >= 4 && c.hour < 9 && hasEv(c, 'drink') },
    { id: 'balanced', kind: 'good', rarity: 'rare', icon: '⚖️', title: 'Code review пройден',
      desc: 'За день 6 стаканов, 6 перерывов и ни разу больше часа на стуле.',
      test: (c) => c.balancedDay() },
    { id: 'streak3', kind: 'good', rarity: 'rare', icon: '📈', title: 'Стабильный релиз',
      desc: '3 хороших дня подряд (6 стаканов и 4 перерыва).', max: 3, cur: (c) => c.streak() },
    { id: 'streak7', kind: 'good', rarity: 'legendary', icon: '🏅', title: 'Неделя без багов',
      desc: '7 хороших дней подряд. LTS-версия тебя.', max: 7, cur: (c) => c.streak() },
    { id: 'alive3', kind: 'good', rarity: 'rare', icon: '🌱', title: 'Не пропадёт',
      desc: 'Жаба живёт 3 дня по календарю. Аптайм лучше, чем у прода.', max: 3, cur: (c) => c.ageDays },
    { id: 'alive7', kind: 'good', rarity: 'epic', icon: '🌿', title: 'Аптайм 99.9%',
      desc: 'Жаба живёт 7 дней по календарю. SLA выполнен.', max: 7, cur: (c) => c.ageDays },
    { id: 'alive30', kind: 'good', rarity: 'legendary', icon: '🌳', title: 'Долгожитель',
      desc: 'Жаба живёт 30 дней по календарю. Пора выпускать мемуары.', max: 30, cur: (c) => c.ageDays },
    { id: 'phoenix', kind: 'good', rarity: 'common', icon: '🐣', title: 'Феникс',
      desc: 'Возродил жабу. Have you tried turning it off and on again?',
      test: (c) => hasEv(c, 'reborn') || num(c.view.generation) >= 2 },
    { id: 'zero_downtime', kind: 'good', rarity: 'epic', icon: '🟢', title: 'Zero downtime',
      desc: 'Целый день без смертей и с 6+ стаканами.', test: (c) => c.zeroDowntime() },

    // ---------- позорные ----------
    { id: 'iron_butt', kind: 'bad', rarity: 'epic', icon: '🪑', title: 'Железножопая жаба',
      desc: 'До 2 ч без перерыва, почти до камня. Стул просит пощады.',
      test: (c) => num(c.view.sitMin) >= c.ironMin || c.day.maxSit >= c.ironMin },
    { id: 'jade', kind: 'bad', rarity: 'rare', icon: '🗿', title: 'Нефритовая жаба',
      desc: 'Жаба окаменела насмерть. Зато в Китае ценится.', test: (c) => c.deathsStone >= 1 },
    { id: 'raisin', kind: 'bad', rarity: 'rare', icon: '🍇', title: 'Изюм',
      desc: 'Жаба засохла насмерть. Можно класть в булочку.', test: (c) => c.deathsDry >= 1 },
    { id: 'mummy', kind: 'bad', rarity: 'epic', icon: '🧟', title: 'Мумия фараона',
      desc: 'Засушил жабу 3 раза. Египтяне аплодируют.', max: 3, cur: (c) => c.deathsDry },
    { id: 'monument', kind: 'bad', rarity: 'epic', icon: '🏛️', title: 'Памятник себе',
      desc: 'Окаменил жабу 3 раза. Открываем аллею славы.', max: 3, cur: (c) => c.deathsStone },
    { id: 'combo', kind: 'bad', rarity: 'rare', icon: '☯️', title: 'Fullstack-убийца',
      desc: 'Жаба умирала и от жажды, и от камня. Покрыл все кейсы.',
      test: (c) => c.deathsDry >= 1 && c.deathsStone >= 1 },
    { id: 'tamagotchi', kind: 'bad', rarity: 'legendary', icon: '💀', title: 'Тамагочи-убийца',
      desc: '5 мёртвых жаб. Тебе нельзя даже кактус.', max: 5, cur: (c) => c.deaths },
    { id: 'speedrun', kind: 'bad', rarity: 'rare', icon: '⏱️', title: 'Speedrun any%',
      desc: 'Умерла за 3 часа или без единого стакана и перерыва.',
      test: (c) => hasEv(c, 'death', (e) => (typeof e.ageMin === 'number' && e.ageMin < SPEEDRUN_MIN) || !c.s.cared) },
    { id: 'vobla', kind: 'bad', rarity: 'common', icon: '🐟', title: 'Сушёная вобла',
      desc: 'Довёл жабу до критической засухи. К пиву сойдёт.',
      test: (c) => hasEv(c, 'critical', (e) => e.kind === 'water') || !!(c.view.critical && c.view.critical.water) },
    { id: 'gargoyle', kind: 'bad', rarity: 'common', icon: '🦇', title: 'Горгулья',
      desc: 'Жаба почти окаменела. Уже можно ставить на собор.',
      test: (c) => hasEv(c, 'critical', (e) => e.kind === 'move') || !!(c.view.critical && c.view.critical.move) },
    { id: 'night', kind: 'bad', rarity: 'rare', icon: '🌙', title: 'Ночная жаба',
      desc: 'Кодишь после 2 ночи. Баги любят темноту.',
      test: (c) => c.hour >= 2 && c.hour < 5 && c.view.activity === 'coding' },
    { id: 'snooze10', kind: 'bad', rarity: 'rare', icon: '⏰', title: 'Snooze-инженер',
      desc: 'Отложил напоминание 10 раз. «Потом» — твой любимый спринт.', max: 10, cur: (c) => c.s.snoozes },
    { id: 'tech_debt', kind: 'bad', rarity: 'rare', icon: '📉', title: 'Технический долг',
      desc: 'Проигнорировал 5 напоминаний подряд. Проценты капают.',
      test: (c) => hasEv(c, 'remind', (e) => num(e.nag) >= 5) },
    { id: 'workaholic', kind: 'bad', rarity: 'epic', icon: '🔥', title: 'Синдром 10x',
      desc: '10 часов кодинга за день. Выгорание уже в пути.', test: (c) => c.day.coding >= 600 },

    // ---------- секретные ----------
    { id: 'poke50', kind: 'secret', rarity: 'epic', icon: '👉', title: 'Работает — не трогай',
      desc: 'Тыкнул жабу 50 раз. Она всё помнит.', max: 50, cur: (c) => c.s.pokes },
    { id: 'ddos', kind: 'secret', rarity: 'rare', icon: '🌩️', title: 'DDoS-атака',
      desc: '10 тычков за 10 секунд. Rate limit превышен.',
      test: (c) => c.s.pokeTimes.length >= 10 && c.now - c.s.pokeTimes[c.s.pokeTimes.length - 10] <= 10 * SEC },
    { id: 'drag1', kind: 'secret', rarity: 'common', icon: '🫳', title: 'Drag & Drop',
      desc: 'Перетащил жабу. Её не спросили.', test: (c) => c.s.drags >= 1 },
    { id: 'drag10', kind: 'secret', rarity: 'rare', icon: '🚚', title: 'Переезд в новый офис',
      desc: 'Перетащил жабу 10 раз. Опен-спейс ей не нравится.', max: 10, cur: (c) => c.s.drags },
    { id: 'vodohleb', kind: 'secret', rarity: 'rare', icon: '🫗', title: 'Водохлёб',
      desc: '3 стакана за 5 минут. Это не гидратация, это DDoS почек.',
      test: (c) => c.s.drinkTimes.length >= 3 && c.now - c.s.drinkTimes[c.s.drinkTimes.length - 3] <= 5 * MIN },
    { id: 'leet', kind: 'secret', rarity: 'legendary', icon: '🕶️', title: '1337 h4x0r',
      desc: 'Вернулся с перерыва ровно в 13:37.',
      test: (c) => c.hour === 13 && new Date(c.now).getMinutes() === 37 && hasEv(c, 'back') },
    { id: 'ctrl_z', kind: 'secret', rarity: 'rare', icon: '↩️', title: 'Ctrl+Z',
      desc: 'Воскресил жабу меньше чем через минуту после смерти.',
      test: (c) => hasEv(c, 'reborn') && c.s.lastDeathAt > 0 && c.now - c.s.lastDeathAt <= MIN },
    { id: 'friday', kind: 'secret', rarity: 'epic', icon: '🍻', title: 'Пятничный деплой',
      desc: 'Жаба умерла в пятницу вечером. Классика.',
      test: (c) => c.dow === 5 && c.hour >= 17 && hasEv(c, 'death') },
    { id: 'necro_poke', kind: 'secret', rarity: 'common', icon: '🪦', title: 'Ты там живая?',
      desc: 'Тыкнул мёртвую жабу. Ping: timeout.',
      test: (c) => c.dead && hasEv(c, 'poke') },
  ];


  const HIDDEN = { title: '???', desc: 'Секретная ачивка. Жаба не скажет 🤫', icon: '❓' };

  function createAchievements(saved) {
    saved = saved && typeof saved === 'object' ? saved : {};
    const unlocked = Object.assign({}, saved.unlocked || {}); // id -> at
    const prog = Object.assign({}, saved.prog || {});         // id -> cur
    const s = Object.assign({
      pokes: 0, drags: 0, snoozes: 0, drinks: 0, stretches: 0, backs: 0,
      deaths: 0, deathsDry: 0, deathsStone: 0, lastDeathAt: 0,
      pokeTimes: [], drinkTimes: [], deathDays: [], bornAt: 0,
      // cared: этой жабе давали воду или перерыв (для speedrun). У старых сохранений поля нет —
      // считаем, что давали, чтобы не выдать ачивку зря
      cared: !!saved.s,
    }, saved.s || {});
    ['pokeTimes', 'drinkTimes', 'deathDays'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });

    let streakCache = { key: '', val: 0 };
    let zeroCache = { key: '', val: false };
    let balancedCache = { key: '', val: false };

    // День, в который жаба хоть раз была мёртвой (смерть или тик в смерти) — не zero downtime
    function markDown(now) {
      const k = dayKey(now);
      if (s.deathDays[s.deathDays.length - 1] !== k && s.deathDays.indexOf(k) < 0) s.deathDays = s.deathDays.concat(k).slice(-40);
    }

    // Обновляем свои счётчики по событиям тика
    function absorb(events, now, dead) {
      for (const e of events) {
        if (!e || !e.type) continue;
        switch (e.type) {
          case 'poke':
            s.pokes++; s.pokeTimes.push(now);
            if (s.pokeTimes.length > 10) s.pokeTimes = s.pokeTimes.slice(-10);
            break;
          case 'dragged': s.drags++; break;
          case 'snooze': s.snoozes++; break;
          case 'drink':
            s.cared = true;
            s.drinks++; s.drinkTimes.push(now);
            if (s.drinkTimes.length > 3) s.drinkTimes = s.drinkTimes.slice(-3);
            break;
          case 'stretch': s.stretches++; s.cared = true; break;
          case 'back': s.backs++; s.cared = true; break;
          case 'death':
            s.deaths++;
            if (e.cause === 'dry') s.deathsDry++;
            if (e.cause === 'stone') s.deathsStone++;
            s.lastDeathAt = now;
            break;
          case 'reborn': s.bornAt = now; s.cared = false; break;
        }
      }
      if (!s.bornAt && !dead) s.bornAt = now;
      if (dead) markDown(now);
    }

    function check(ctx) {
      ctx = ctx || {};
      const now = num(ctx.now) || Date.now();
      const events = Array.isArray(ctx.events) ? ctx.events : [];
      const view = ctx.view || {};
      const state = ctx.state || {};
      const totals = view.totals || state.totals || {};
      const dead = view.life === 'dead' || hasEv({ events }, 'death');

      absorb(events, now, dead);

      const vd = view.day || {};
      const sd = state.day || {};
      const d = new Date(now);
      const ageMin = typeof view.ageMin === 'number' ? view.ageMin
        : (num(state.bornAt) || s.bornAt) ? (now - (num(state.bornAt) || s.bornAt)) / MIN : 0;

      const c = {
        now, events, view, state, s, dead,
        hour: d.getHours(), dow: d.getDay(),
        day: {
          drinks: num(vd.drinks != null ? vd.drinks : sd.drinks),
          breaks: num(vd.breaks != null ? vd.breaks : num(sd.breaks) + num(sd.autoBreaks)),
          stretches: num(sd.breaks),
          coding: num(vd.coding != null ? vd.coding : num(sd.codingMs) / MIN),
          maxSit: num(vd.maxSit != null ? vd.maxSit : num(sd.maxSitMs) / MIN),
        },
        drinksTotal: Math.max(num(totals.drinks), s.drinks),
        stretchTotal: Math.max(num(totals.breaks), s.stretches),
        breaksTotal: Math.max(num(totals.breaks) + num(totals.autoBreaks), s.stretches + s.backs),
        deaths: Math.max(num(totals.deaths), s.deaths),
        deathsDry: Math.max(num(totals.deathsDry), s.deathsDry),
        deathsStone: Math.max(num(totals.deathsStone), s.deathsStone),
        ageDays: dead ? 0 : Math.floor(ageMin / DAY_MIN),
        ironMin: ironMin(ctx.settings),
        streak: () => streak(state, sd),
        zeroDowntime: () => zeroDowntime(state),
        balancedDay: () => balancedDay(state),
      };

      const out = [];
      for (const def of DEFS) {
        if (unlocked[def.id]) continue;
        let ok;
        if (def.max) {
          // текущий факт, а не рекорд: дневные, серии и возраст жабы могут падать до 0
          const cur = Math.min(def.max, Math.max(0, Math.floor(num(def.cur(c)))));
          prog[def.id] = cur;
          ok = cur >= def.max;
        } else {
          ok = !!def.test(c);
        }
        if (ok) {
          unlocked[def.id] = now;
          out.push({ id: def.id, title: def.title, desc: def.desc, icon: def.icon, kind: def.kind, rarity: def.rarity, at: now });
        }
      }
      return out;
    }

    // Серия хороших дней подряд, заканчивающаяся сегодня (если сегодня уже хороший) или вчера
    function streak(state, sd) {
      const hist = Array.isArray(state.history) ? state.history : [];
      const last = hist[hist.length - 1];
      const key = hist.length + '|' + (last && last.date) + '|' + sd.date + '|' + sd.drinks + '|' + sd.breaks + '|' + sd.autoBreaks;
      if (streakCache.key === key) return streakCache.val;
      const days = hist.slice();
      if (sd.date) days.push(sd);
      let n = 0, prev = NaN, i = days.length - 1;
      if (i >= 0 && days[i] === sd && !goodDay(sd)) { prev = keyToNum(sd.date); i--; }
      for (; i >= 0; i--) {
        const k = keyToNum(days[i].date);
        if (!isNaN(prev) && prev - k !== 1) break;
        if (!goodDay(days[i])) break;
        n++; prev = k;
      }
      streakCache = { key, val: n };
      return n;
    }

    // Закрытый день в истории: 6+ стаканов и ни одной смерти
    function zeroDowntime(state) {
      const hist = Array.isArray(state.history) ? state.history : [];
      const last = hist[hist.length - 1];
      const key = hist.length + '|' + (last && last.date) + '|' + s.deathDays.length + '|' + s.deathDays[s.deathDays.length - 1];
      if (zeroCache.key === key) return zeroCache.val;
      let val = false;
      for (const h of hist.slice(-7)) {
        if (h && num(h.drinks) >= 6 && !num(h.deaths) && s.deathDays.indexOf(h.date) < 0) { val = true; break; }
      }
      zeroCache = { key, val };
      return val;
    }

    // Закрытый день в истории: 6+ стаканов, 6+ перерывов, ни разу больше часа на стуле.
    // Открытый день не годится: «ни разу больше часа» становится правдой только к его концу.
    function balancedDay(state) {
      const hist = Array.isArray(state.history) ? state.history : [];
      const last = hist[hist.length - 1];
      const key = hist.length + '|' + (last && last.date);
      if (balancedCache.key === key) return balancedCache.val;
      let val = false;
      for (const h of hist.slice(-7)) {
        if (h && num(h.drinks) >= 6 && num(h.breaks) + num(h.autoBreaks) >= 6 && num(h.maxSitMs) <= 60 * MIN) { val = true; break; }
      }
      balancedCache = { key, val };
      return val;
    }

    function list() {
      return DEFS.map((def) => {
        const at = unlocked[def.id] || 0;
        const hidden = def.kind === 'secret' && !at;
        const progress = def.max && !hidden ? { cur: at ? def.max : Math.min(def.max, num(prog[def.id])), max: def.max } : null;
        return {
          id: def.id,
          title: hidden ? HIDDEN.title : def.title,
          desc: hidden ? HIDDEN.desc : def.desc,
          icon: hidden ? HIDDEN.icon : def.icon,
          kind: def.kind, rarity: def.rarity,
          hidden, unlocked: !!at, at, progress,
        };
      });
    }

    function serialize() {
      return JSON.parse(JSON.stringify({ v: 1, unlocked, prog, s }));
    }

    return { check, list, serialize };
  }

  // Публичные описания без функций-проверок
  const PUBLIC_DEFS = DEFS.map((d) => ({
    id: d.id, title: d.title, desc: d.desc, icon: d.icon, kind: d.kind, rarity: d.rarity, max: d.max || null,
  }));

  return { createAchievements, DEFS: PUBLIC_DEFS, HIDDEN, ironMin, DEATH_WATER, DEATH_STONE, DEF_SET };
});
