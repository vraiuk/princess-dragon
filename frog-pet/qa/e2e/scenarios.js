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
];
