'use strict';
// Манифест e2e-сценариев для qa/e2e/run.js.
// Сценарий = скрипт + фазы. Каждая фаза — отдельный запуск Electron с тем же временным HOME,
// так что фазы проверяют перезапуск. Поля фазы:
//   name     — попадает в E2E_PHASE, скрипт ветвится по H.phase
//   env      — дополнительные переменные окружения
//   setup    — (ctx) => {...} в node до запуска: например, положить frog.json в ctx.userData
//   check    — (ctx) => [[условие, 'что проверили'], ...] в node после выхода
//   second   — запустить второй экземпляр, когда первый напечатает [ready]: { expectExit, timeout }
//   timeout  — мс на фазу (по умолчанию 60 с)
//   allow    — RegExp: строки-признаки падения, которые в этой фазе ожидаемы (сценарий сам роняет рендер)
const fs = require('fs');
const path = require('path');
const fx = require('./fixtures');

const corrupt = (kind, extra = {}) => ({
  name: 'corrupt-' + kind,
  script: 'corrupt-file.js',
  phases: [
    {
      name: 'start',
      env: extra.env,
      setup: (ctx) => fx.corrupt(ctx.userData, kind),
      // нечитаемый JSON не затирается молча, а копируется рядом
      check: extra.unparsable ? (ctx) => [[fs.existsSync(path.join(ctx.userData, 'frog.json.broken')), 'unreadable file kept as frog.json.broken']] : undefined,
    },
    { name: 'restart' },
  ],
});

module.exports = [
  { name: 'onboarding', script: 'onboarding.js', phases: [{ name: 'first-run' }, { name: 'second-run' }] },
  { name: 'migration-v1', script: 'migration-v1.js', phases: [{ name: 'start', setup: (ctx) => fx.v1(ctx.userData, { waterMin: 10, sitMin: 5 }) }] },
  { name: 'actions-settings', script: 'actions-settings.js', phases: [{ name: 'act' }, { name: 'restart' }] },
  { name: 'death', script: 'death.js', phases: [{ name: 'die' }, { name: 'restart' }] },
  { name: 'app-windows', script: 'app-windows.js', phases: [{ name: 'start' }] },
  { name: 'film', script: 'film.js', phases: [{ name: 'start', timeout: 120000 }] },
  corrupt('truncated', { unparsable: true, env: { DRAG: '1' } }),
  corrupt('wrong-types'),
  corrupt('junk-fields'),
  { name: 'single-instance', script: 'single-instance.js', phases: [{ name: 'start', second: { expectExit: 0, timeout: 20000 } }] },
  { name: 'app-menu', script: 'app-menu.js', phases: [{ name: 'start' }] },
  // круг 2: main/preload/IPC
  { name: 'chaos', script: 'chaos.js', phases: [{ name: 'start', allow: /\[renderer gone\] crashed/ }] },
  {
    name: 'security',
    script: 'security.js',
    phases: [
      { name: 'start', setup: (ctx) => fx.corrupt(ctx.userData, 'truncated') },
      // второй битый файл не затирает копию первого
      {
        name: 'again',
        setup: (ctx) => fx.corrupt(ctx.userData, 'truncated'),
        check: (ctx) => {
          const b = fs.readdirSync(ctx.userData).filter((f) => f.startsWith('frog.json.broken'));
          return [[b.length >= 2, 'both broken copies kept: ' + b.join(', ')]];
        },
      },
    ],
  },
  { name: 'perf', script: 'perf.js', phases: [{ name: 'start' }] },
  { name: 'nag', script: 'nag.js', phases: [{ name: 'start' }, { name: 'burst' }] },
  // круг 4 (G2): r3-07, r3-06-05, «Позже», r1-05-10, r3-10-01/02
  {
    name: 'r4-crash', script: 'round4.js',
    phases: [{ name: 'crash', timeout: 150000, allow: /\[renderer gone\] crashed/ }],
  },
  { name: 'r4-screens', script: 'round4.js', phases: [{ name: 'screens' }] },
  {
    name: 'r4-startup',
    script: 'round4.js',
    phases: [[-100, -100], [1700, 800], [-200, 500]].map((pos, i) => ({
      name: 'startup-' + i,
      env: { E2E_POS: JSON.stringify(pos) },
      setup: (ctx) => fx.write(ctx.userData, { settings: {}, onboarded: true, pos }),
    })),
  },
  { name: 'r4-film', script: 'round4.js', phases: [{ name: 'film' }] },
  { name: 'r4-later', script: 'round4.js', phases: [{ name: 'later' }] },
  { name: 'r4-joint', script: 'round4.js', phases: [{ name: 'joint' }] },
  { name: 'r4-death', script: 'round4.js', phases: [{ name: 'death' }] },
  { name: 'r4-menu', script: 'round4.js', phases: [{ name: 'menu' }] },
  { name: 'r4-flood', script: 'round4.js', phases: [{ name: 'flood', timeout: 120000 }] },
  {
    name: 'r4-broken',
    script: 'round4.js',
    phases: [1, 2].map((i) => ({
      name: 'broken-' + i,
      // битый frog.json с правами 0644, забытый frog.json.tmp 0644 и уже 4 старые копии
      setup: (ctx) => {
        fx.corrupt(ctx.userData, 'truncated');
        fs.chmodSync(ctx.storePath, 0o644);
        fs.writeFileSync(ctx.storePath + '.tmp', 'old', { mode: 0o644 });
        fs.chmodSync(ctx.storePath + '.tmp', 0o644);
        if (i === 1) {
          for (let k = 0; k < 4; k++) {
            const f = ctx.storePath + (k ? '.broken-' + (1000 + k) : '.broken');
            fs.writeFileSync(f, 'x', { mode: 0o644 });
            fs.utimesSync(f, new Date(Date.now() - (10 - k) * 60000), new Date(Date.now() - (10 - k) * 60000));
          }
        }
      },
      check: (ctx) => {
        const mode = (f) => (fs.statSync(path.join(ctx.userData, f)).mode & 0o777).toString(8);
        const b = fs.readdirSync(ctx.userData).filter((f) => f.startsWith('frog.json.broken'));
        const loose = b.filter((f) => mode(f) !== '600').map((f) => f + ':' + mode(f));
        return [
          [b.length >= 1 && b.length <= 3, 'broken copies rotated (≤3): ' + b.join(', ')],
          [loose.length === 0, 'broken copies are 0600: ' + (loose.join(', ') || 'ok')],
          [mode('frog.json') === '600', 'frog.json 0600 even if stale .tmp was 0644: ' + mode('frog.json')],
        ];
      },
    })),
  },
];
