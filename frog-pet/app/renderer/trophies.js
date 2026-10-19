// Окно «Трофеи»: ачивки, статистика за 14 дней, кладбище жаб.
(function () {
  'use strict';
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;

  // ---------- мок для разработки в браузере ----------
  function makeMock() {
    const now = Date.now();
    const dk = (t) => {
      const d = new Date(t);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const history = [];
    for (let i = 16; i >= 1; i--) {
      const s = Math.sin(i * 1.7) * 0.5 + 0.5, wk = new Date(now - i * DAY).getDay() % 6 === 0;
      history.push({
        date: dk(now - i * DAY),
        drinks: wk ? Math.round(s * 3) : 3 + Math.round(s * 6),
        breaks: wk ? 1 : 2 + Math.round((1 - s) * 4),
        autoBreaks: wk ? 1 : 1 + (i % 3),
        codingMs: (wk ? 60 + s * 90 : 220 + s * 260) * MIN,
        maxSitMs: (40 + s * 110) * MIN,
      });
    }
    const day = { date: dk(now), drinks: 4, breaks: 2, autoBreaks: 3, codingMs: 297 * MIN, maxSitMs: 84 * MIN };
    const A = (id, icon, title, desc, kind, rarity, at, progress) => ({
      id, icon, title, desc, kind, rarity, hidden: kind === 'secret', unlocked: !!at, at: at || 0, progress: progress || null,
    });
    const achievements = [
      A('first_drink', '💧', 'Первый глоток', 'Выпить первый стакан воды', 'good', 'common', now - 13 * DAY),
      A('hydro_8', '🌊', 'Гидро-сеньор', '8 стаканов воды за день', 'good', 'rare', now - 6 * DAY),
      A('hydro_100', '🐳', 'Кит-девелопер', '100 стаканов за всё время', 'good', 'epic', 0, { cur: 63, max: 100 }),
      A('stretch_5', '🤸', 'Гибкий как Agile', '5 разминок за день', 'good', 'common', now - 2 * DAY),
      A('streak_7', '🔥', 'Неделя без техдолга', '7 дней подряд выполнять норму воды', 'good', 'epic', 0, { cur: 4, max: 7 }),
      A('streak_30', '👑', 'Жабий император', '30 дней подряд норма воды и разминок', 'good', 'legendary', 0, { cur: 4, max: 30 }),
      A('immortal', '🧬', 'Бессмертный билд', 'Жаба прожила 7 дней', 'good', 'legendary', 0, { cur: 2, max: 7 }),
      A('iron_butt', '🪑', 'Железножопая жаба', '2 часа без перерыва', 'bad', 'rare', now - 5 * DAY - 3 * 3600e3),
      A('jade', '🗿', 'Нефритовая жаба', 'Жаба окаменела насмерть', 'bad', 'epic', now - 4 * DAY),
      A('raisin', '🍇', 'Изюм', 'Жаба засохла насмерть', 'bad', 'epic', now - 9 * DAY),
      A('night_owl', '🦉', 'Ночной деплой', 'Кодить после 2 ночи', 'bad', 'rare', 0),
      A('snoozer', '😴', 'Отложу на потом', 'Отложить напоминание 10 раз', 'bad', 'common', 0, { cur: 6, max: 10 }),
      A('serial', '💀', 'Серийный жабоубийца', 'Погубить 5 жаб', 'bad', 'legendary', 0, { cur: 3, max: 5 }),
      A('poke50', '👉', 'Пальпация', 'Тыкнуть жабу 50 раз', 'secret', 'rare', now - 1 * DAY),
      A('drag', '🛸', 'Похищение', '???', 'secret', 'epic', 0),
      A('konami', '🎮', 'Чит-код', '???', 'secret', 'legendary', 0),
    ];
    const graveyard = [
      { generation: 1, cause: 'dry', bornAt: now - 13 * DAY, diedAt: now - 9 * DAY - 5 * 3600e3, ageMin: 5520 },
      { generation: 2, cause: 'stone', bornAt: now - 9 * DAY, diedAt: now - 4 * DAY - 2 * 3600e3, ageMin: 7080 },
      { generation: 3, cause: 'stone', bornAt: now - 4 * DAY, diedAt: now - 2 * DAY - 7 * 3600e3, ageMin: 147 },
    ];
    const view = {
      life: 'alive', generation: 4, bornAt: now - 2 * DAY + 3 * 3600e3, ageMin: 2700,
      totals: { drinks: 63, breaks: 41, autoBreaks: 38, deaths: 3, deathsDry: 1, deathsStone: 2, codingMs: 74 * 60 * MIN, maxSitMs: 131 * MIN, longestLifeMin: 7080, days: 17 },
      graveyardCount: 3,
    };
    const data = { settings: {}, view, state: { day, history, graveyard }, achievements, graveyard, version: 'dev' };
    return {
      getData: () => Promise.resolve(data),
      onUpdate() {},
      action(type) { console.log('[mock] action', type); },
      open(name) { console.log('[mock] open', name); },
      close() { console.log('[mock] close'); },
    };
  }

  const app = window.frogApp || makeMock();

  // ---------- утилиты ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (Number(v) || 0);
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  const fmtDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  const fmtDateTime = (t) => fmtDate(t) + ', ' + new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function fmtDur(min) {
    min = Math.max(0, Math.round(num(min)));
    if (min < 60) return min + ' мин';
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + ' ч' + (m ? ' ' + m + ' мин' : '');
    const d = Math.floor(h / 24), hh = h % 24;
    return d + ' ' + plural(d, 'день', 'дня', 'дней') + (hh ? ' ' + hh + ' ч' : '');
  }
  // большие суммы времени — в часах, без «дней»
  const fmtHours = (min) => (min >= 24 * 60 ? Math.round(min / 60) + ' ч' : fmtDur(min));
  const dk = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ---------- вкладки ----------
  const TABS = ['ach', 'stats', 'grave'];
  let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ach';
  let filter = 'all';
  let data = null;
  const last = {};   // кэш отрисовки: перерисовываем вкладку, только если её данные изменились

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tr-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    for (const id of TABS) $('#pane-' + id).hidden = id !== t;
    try { history.replaceState(null, '', '#' + t); } catch (e) { /* file:// */ }
    render();
  }
  document.querySelectorAll('.tr-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') app.close && app.close();
    if ((e.metaKey || e.ctrlKey) && /^[123]$/.test(e.key)) setTab(TABS[+e.key - 1]);
  });

  // ---------- ачивки ----------
  const RARITY = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', legendary: 'Легендарная' };
  const KINDS = [['all', 'Все'], ['good', '🌿 Хорошие'], ['bad', '💩 Позорные'], ['secret', '🔮 Секретные']];

  function card(a) {
    const locked = !a.unlocked;
    const hide = locked && (a.hidden || a.kind === 'secret');
    const cls = ['ach', 'k-' + (a.kind || 'good'), 'r-' + (a.rarity || 'common'), locked ? 'locked' : 'got', hide ? 'mystery' : ''].join(' ');
    const p = a.progress && !a.unlocked && !hide && num(a.progress.max) > 0 ? a.progress : null;
    const pct = p ? Math.min(100, Math.round(num(p.cur) / num(p.max) * 100)) : 0;
    return `<article class="${cls}" title="${esc(RARITY[a.rarity] || '')}">
      <div class="ach-icon">${hide ? '🔒' : esc(a.icon || '🏅')}</div>
      <div class="ach-body">
        <div class="ach-title">${hide ? '???' : esc(a.title)}</div>
        <div class="ach-desc">${hide ? 'Секретная ачивка. Ищи сам — жаба не скажет.' : esc(a.desc)}</div>
        ${p ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="ach-prog">${num(p.cur)} / ${num(p.max)}</div>` : ''}
        <div class="ach-foot">
          <span class="rar">${esc(RARITY[a.rarity] || 'Обычная')}</span>
          ${a.unlocked && a.at ? `<span class="when">✓ ${esc(fmtDate(a.at))}</span>` : ''}
        </div>
      </div>
    </article>`;
  }

  function renderAch() {
    const list = (data.achievements || []).slice();
    const got = list.filter((a) => a.unlocked).length;
    const pct = list.length ? got / list.length : 0;
    const R = 26, C = 2 * Math.PI * R;
    const cnt = (k) => list.filter((a) => a.kind === k && a.unlocked).length + '/' + list.filter((a) => a.kind === k).length;
    const order = { good: 0, bad: 1, secret: 2 };
    const rar = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const shown = list
      .filter((a) => filter === 'all' || a.kind === filter)
      .sort((a, b) => (b.unlocked - a.unlocked) || (a.unlocked ? num(b.at) - num(a.at) : 0) ||
        ((order[a.kind] || 0) - (order[b.kind] || 0)) || ((rar[a.rarity] || 0) - (rar[b.rarity] || 0)));
    $('#pane-ach').innerHTML = `
      <div class="summary">
        <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="${R}" class="ring-bg"/>
          <circle cx="32" cy="32" r="${R}" class="ring-fg" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
          <text x="32" y="37" text-anchor="middle">${Math.round(pct * 100)}%</text>
        </svg>
        <div class="sum-txt">
          <div class="sum-big">Получено ${got} из ${list.length}</div>
          <div class="sum-sub">🌿 ${cnt('good')} · 💩 ${cnt('bad')} · 🔮 ${cnt('secret')}</div>
        </div>
        <div class="chips">${KINDS.map(([k, t]) => `<button class="chip${filter === k ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
      </div>
      ${shown.length ? `<div class="grid">${shown.map(card).join('')}</div>` : '<div class="empty">Тут пока пусто. Жаба верит в тебя 🐸</div>'}`;
    $('#pane-ach').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; last.ach = null; render(); }));
  }

  // ---------- статистика ----------
  function days14() {
    const st = data.state || {};
    const all = (st.history || []).concat(st.day ? [st.day] : []);
    const map = {};
    for (const d of all) if (d && d.date) map[d.date] = d;
    const today = st.day && st.day.date ? st.day.date : dk(Date.now());
    const [y, m, dd] = today.split('-').map(Number);
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const t = new Date(y, m - 1, dd - i, 12).getTime();
      const k = dk(t), d = map[k] || {};
      out.push({
        t, key: k, today: i === 0,
        drinks: num(d.drinks),
        breaks: num(d.breaks) + num(d.autoBreaks),
        coding: Math.round(num(d.codingMs) / MIN),
      });
    }
    return out;
  }

  function chart(days, field, cls, unit) {
    const W = 640, H = 128, top = 20, bot = 30, gap = 8;
    const max = Math.max(1, ...days.map((d) => d[field]));
    const bw = (W - gap * (days.length - 1)) / days.length;
    const ch = H - top - bot;
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    let bars = '';
    days.forEach((d, i) => {
      const v = d[field], h = v ? Math.max(4, v / max * ch) : 2;
      const x = i * (bw + gap), y = top + ch - h;
      const lbl = field === 'coding' && v >= 60 ? (v / 60).toFixed(1).replace('.0', '').replace('.', ',') + 'ч' : String(v);
      const dt = new Date(d.t);
      bars += `<g class="col${d.today ? ' today' : ''}${v ? '' : ' zero'}">
        <title>${esc(fmtDate(d.t))}: ${v} ${unit}</title>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, bw / 3).toFixed(1)}"/>
        ${v ? `<text class="val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${lbl}</text>` : ''}
        <text class="day" x="${(x + bw / 2).toFixed(1)}" y="${H - 15}" text-anchor="middle">${d.today ? 'сег' : dt.getDate()}</text>
        <text class="wd" x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${wd[dt.getDay()]}</text>
      </g>`;
    });
    return `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" role="img">
      <line class="base" x1="0" x2="${W}" y1="${top + ch + 0.5}" y2="${top + ch + 0.5}"/>${bars}</svg>`;
  }

  function panel(days, field, cls, icon, title, unit, fmt) {
    const sum = days.reduce((s, d) => s + d[field], 0);
    const active = days.filter((d) => d[field] > 0).length || 1;
    const today = days[days.length - 1][field];
    return `<div class="panel">
      <div class="panel-head">
        <div class="panel-title"><span class="dot ${cls}"></span>${icon} ${title}</div>
        <div class="panel-meta">сегодня <b>${fmt(today)}</b> · в среднем <b>${fmt(Math.round(sum / active))}</b> · за 14 дней <b>${field === 'coding' ? fmtHours(sum) : fmt(sum)}</b></div>
      </div>
      ${chart(days, field, cls, unit)}
    </div>`;
  }

  function renderStats() {
    const days = days14();
    const v = data.view || {};
    const T = v.totals || {};
    const hm = (min) => fmtDur(min);
    const tiles = [
      ['💧', num(T.drinks), plural(num(T.drinks), 'стакан', 'стакана', 'стаканов') + ' воды всего'],
      ['🤸', num(T.breaks) + num(T.autoBreaks), 'разминок и перерывов'],
      ['⌨️', fmtHours(num(T.codingMs) / MIN), 'за компом всего'],
      ['🪑', fmtDur(num(T.maxSitMs) / MIN), 'самый долгий заход без перерыва'],
      ['🧬', fmtDur(T.longestLifeMin), 'самая долгая жизнь жабы'],
      ['💀', num(T.deaths), plural(num(T.deaths), 'смерть', 'смерти', 'смертей') + ` (🥵 ${num(T.deathsDry)} · 🗿 ${num(T.deathsStone)})`],
      ['🐸', '#' + (num(v.generation) || 1), v.life === 'dead' ? 'текущая жаба — увы, мертва' : 'номер текущей жабы'],
      ['🎂', fmtDur(v.ageMin), 'возраст текущей жабы'],
    ];
    $('#pane-stats').innerHTML = `
      ${panel(days, 'drinks', 'c-water', '💧', 'Стаканы воды', 'стак.', String)}
      ${panel(days, 'breaks', 'c-move', '🤸', 'Разминки и перерывы', 'раз', String)}
      ${panel(days, 'coding', 'c-code', '⌨️', 'Время за компом', 'мин', hm)}
      <h3 class="sec">🏅 Рекорды и итоги${T.days ? ` <span>за ${num(T.days)} ${plural(num(T.days), 'день', 'дня', 'дней')}</span>` : ''}</h3>
      <div class="tiles">${tiles.map(([i, b, s]) => `<div class="tile"><div class="tile-i">${i}</div><div class="tile-b">${esc(b)}</div><div class="tile-s">${esc(s)}</div></div>`).join('')}</div>`;
  }

  // ---------- кладбище ----------
  const EPI_ANY = [
    'Её последний коммит был без тестов.',
    'Ушла в прод в пятницу вечером.',
    'Так и не дождалась code review.',
    'Работала на её машине.',
    'Пала жертвой бесконечного цикла.',
    'NullPointerException в самом сердце.',
    'Её TODO так и остались TODO.',
    'Отправлена в /dev/null. Без бэкапа.',
    'git blame укажет на тебя.',
    'Не пережила очередной мерж-конфликт.',
    'Её стектрейс был длиннее её жизни.',
    'Говорила «ещё одну таску — и встану».',
  ];
  const EPI = {
    dry: [
      'Последние слова: «щас, только билд дособерётся».',
      'Пересохла быстрее, чем кэш в npm.',
      'Кожа шелушилась, как legacy-код. Воды так и не дали.',
      'waterLevel === 0. Баг закрыт как «won\'t fix».',
      'Хотела стакан воды. Получила 418 I\'m a teapot.',
    ],
    stone: [
      'Сидела, пока не стала памятником собственному аптайму.',
      'Окаменела в ожидании, пока ты встанешь размяться.',
      'Теперь она — монолит. Микросервисы не помогли.',
      'Хотела размяться после деплоя. Деплой не закончился.',
      'Застыла, как продакшн при git push --force.',
    ],
  };
  function epitaph(g) {
    const n = Math.max(1, num(g.generation));
    const pool = (EPI[g.cause] || []).concat(EPI_ANY);
    const k = Math.abs((n * 2654435761) >>> 0) % pool.length;
    return pool[k];
  }

  function renderGrave() {
    const list = (data.graveyard || (data.state && data.state.graveyard) || []).slice()
      .sort((a, b) => num(b.diedAt) - num(a.diedAt) || num(b.generation) - num(a.generation));
    if (!list.length) {
      $('#pane-grave').innerHTML = `<div class="grave-empty"><div class="big">🐸</div>
        <div class="t">Пока ни одна жаба не пострадала 🐸</div>
        <div class="s">Пей воду и вставай размяться — и пусть так будет всегда.</div></div>`;
      return;
    }
    const dry = list.filter((g) => g.cause === 'dry').length, stone = list.length - dry;
    $('#pane-grave').innerHTML = `
      <div class="grave-head">
        <div class="gh-t">Здесь ${plural(list.length, 'покоится', 'покоятся', 'покоятся')} ${list.length} ${plural(list.length, 'жаба', 'жабы', 'жаб')}</div>
        <div class="gh-s">🥵 засохло: ${dry} · 🗿 окаменело: ${stone} · Минута молчания. Потом стакан воды.</div>
      </div>
      <div class="graves">${list.map((g) => {
        const stoneC = g.cause !== 'dry';
        return `<article class="grave ${stoneC ? 'g-stone' : 'g-dry'}">
          <div class="stone">
            <div class="rip">R.I.P.</div>
            <div class="g-name">Жабка #${num(g.generation)}</div>
            <div class="g-cause">${stoneC ? '🗿 окаменела' : '🥵 засохла'}</div>
            <div class="g-dates">${g.bornAt ? esc(fmtDate(g.bornAt)) : '?'} — ${g.diedAt ? esc(fmtDateTime(g.diedAt)) : '?'}</div>
            <div class="g-age">прожила ${esc(fmtDur(g.ageMin))}</div>
            <div class="g-epi">«Здесь лежит Жабка #${num(g.generation)}. ${esc(epitaph(g))}»</div>
          </div>
          <div class="mound">${stoneC ? '🪨' : '🌵'}<span>🌱</span></div>
        </article>`;
      }).join('')}</div>`;
  }

  // ---------- отрисовка ----------
  function sliceFor(t) {
    if (t === 'ach') return JSON.stringify([data.achievements, filter]);
    if (t === 'stats') return JSON.stringify([data.state && data.state.history, data.state && data.state.day, data.view && data.view.totals, data.view && data.view.generation, data.view && Math.floor(num(data.view.ageMin)), data.view && data.view.life]);
    return JSON.stringify([data.graveyard, data.state && data.state.graveyard]);
  }
  function render() {
    if (!data) return;
    const key = sliceFor(tab);
    if (last[tab] === key) return;
    last[tab] = key;
    try {
      if (tab === 'ach') renderAch();
      else if (tab === 'stats') renderStats();
      else renderGrave();
    } catch (e) {
      console.error('trophies render', e);
    }
  }
  function apply(d) {
    if (!d) return;
    data = d;
    render();
  }

  setTab(tab);
  Promise.resolve(app.getData()).then(apply).catch((e) => console.error('getData', e));
  if (app.onUpdate) app.onUpdate(apply);
})();
