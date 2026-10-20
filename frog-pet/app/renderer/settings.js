// Окно «Настройки»: все ключи сразу уходят в main через frogApp.setSetting.
(function () {
  'use strict';

  const DEFAULTS = { waterEvery: 45, moveEvery: 50, breakAfter: 5, nagEvery: 10, sound: true, notify: true, scale: 1, launchAtLogin: true, deathEnabled: true };
  const SCALES = [0.75, 1, 1.25, 1.5];
  const SIZES = ['S', 'M', 'L', 'XL'];

  // мок для браузера: страница открывается и без Electron
  function mockApp() {
    const settings = Object.assign({}, DEFAULTS);
    const data = () => ({ settings: Object.assign({}, settings), view: {}, state: {}, achievements: [], graveyard: [], version: 'dev' });
    return {
      getData: () => Promise.resolve(data()),
      onUpdate() {},
      setSetting(k, v) { settings[k] = v; },
      action() {},
      open(name) { location.href = name + '.html'; },
      finishOnboarding() {},
      close() { window.close(); },
    };
  }
  const app = window.frogApp || mockApp();

  const Core = window.FrogCore || {};
  const DEATH_WATER = Core.DEATH_WATER || 3.0;
  const DEATH_STONE = Core.DEATH_STONE || 2.4;
  const MAX_MIN = 90 * DEATH_WATER;   // самая длинная жизнь — для шкалы

  let S = Object.assign({}, DEFAULTS);
  const $ = (id) => document.getElementById(id);

  // «2 ч 15 мин»
  function fmt(min) {
    min = Math.round(min);
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' мин';
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }

  function set(key, val) {
    S[key] = val;
    try { app.setSetting(key, val); } catch (e) { console.error(e); }
    render();
  }

  // ---------- сегменты ----------
  document.querySelectorAll('.seg[data-key]').forEach((seg) => {
    const key = seg.dataset.key;
    const unit = seg.dataset.unit || '';
    seg.setAttribute('role', 'group');
    // подпись группы — текст строки слева («Стакан воды каждые»), у кнопок — значение с единицей
    const label = seg.closest('.row') && seg.closest('.row').querySelector('.row-label');
    if (label) { label.id = label.id || 'lbl-' + key; seg.setAttribute('aria-labelledby', label.id); }
    seg.dataset.values.split(',').map(Number).forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(v);
      b.title = `${v} ${unit}`;
      if (unit) b.setAttribute('aria-label', `${v} ${unit}`);
      b.dataset.val = v;
      b.addEventListener('click', () => set(key, v));
      seg.appendChild(b);
    });
    const u = document.createElement('span');
    u.className = 'muted small';
    u.textContent = unit;
    seg.after(u);
  });

  // ---------- тумблеры ----------
  document.querySelectorAll('input[type=checkbox][data-key]').forEach((el) => {
    el.addEventListener('change', () => set(el.dataset.key, el.checked));
  });

  // ---------- размер ----------
  const $scale = $('scale');
  function paintSlider() {
    $scale.style.setProperty('--p', ($scale.value / $scale.max) * 100 + '%');
    const pct = Math.round(SCALES[$scale.value] * 100) + '%';
    $('scaleVal').textContent = pct;
    $scale.setAttribute('aria-valuetext', `${SIZES[$scale.value]}, ${pct}`);
  }
  $scale.addEventListener('input', paintSlider);
  $scale.addEventListener('change', () => set('scale', SCALES[$scale.value]));

  // ---------- кнопки ----------
  $('bWelcome').addEventListener('click', () => app.open('welcome'));
  $('bTrophies').addEventListener('click', () => app.open('trophies'));

  function render() {
    document.querySelectorAll('.seg[data-key]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.val) === Number(S[seg.dataset.key]))));
    });
    document.querySelectorAll('input[type=checkbox][data-key]').forEach((el) => { el.checked = !!S[el.dataset.key]; });
    if (document.activeElement !== $scale) {
      let i = SCALES.indexOf(Number(S.scale));
      if (i < 0) i = 1;
      $scale.value = i;
      paintSlider();
    }

    // превью смерти
    const wMin = S.waterEvery * DEATH_WATER, sMin = S.moveEvery * DEATH_STONE;
    const hard = S.deathEnabled !== false;
    $('doom').classList.toggle('kind', !hard);
    if (hard) {
      $('modeLine').innerHTML = '<span class="badge bad">💀 Хардкор</span> жаба смертна — вот её запас прочности';
      $('doomWater').textContent = fmt(wMin);
      $('doomWaterText').textContent = 'без воды — и она засохнет в изюм';
      $('doomStone').textContent = fmt(sMin);
      $('doomStoneText').textContent = 'сидения без перерыва — и окаменеет насмерть';
    } else {
      $('modeLine').innerHTML = '<span class="badge good">🌱 Добрый режим</span> жаба бессмертна, но страдать будет честно';
      $('doomWater').textContent = 'Не умрёт';
      $('doomWaterText').textContent = `через ${fmt(S.waterEvery)} начнёт сохнуть и ныть`;
      $('doomStone').textContent = 'Не умрёт';
      $('doomStoneText').textContent = `через ${fmt(S.moveEvery)} начнёт каменеть`;
    }
    $('doomWaterBar').style.width = Math.min(100, (wMin / MAX_MIN) * 100) + '%';
    $('doomStoneBar').style.width = Math.min(100, (sMin / MAX_MIN) * 100) + '%';
    $('deathHint').textContent = hard
      ? 'Засохнет или окаменеет насовсем. Будет кладбище и новая жаба из яйца.'
      : 'Выключено: жаба сохнет и каменеет, но не умирает. Для слабонервных и созвонов по 3 часа.';
  }

  function apply(d) {
    if (!d || !d.settings) return;
    // null/мусор из frog.json не должен затирать умолчания («0 мин» и ни одного выбранного сегмента)
    S = Object.assign({}, DEFAULTS);
    for (const [k, v] of Object.entries(d.settings)) if (v != null && typeof v === typeof DEFAULTS[k] && (typeof v !== 'number' || v > 0)) S[k] = v;
    if (d.version) $('ver').textContent = 'Жабка ' + d.version;
    render();
  }

  render();
  Promise.resolve(app.getData()).then(apply).catch((e) => console.error(e));
  if (app.onUpdate) app.onUpdate(apply);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.metaKey && e.key === 'w')) app.close && app.close();
  });
})();
