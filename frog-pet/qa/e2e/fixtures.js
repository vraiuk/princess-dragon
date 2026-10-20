'use strict';
// Готовые frog.json для сценариев. Выполняется в node (run.js) до запуска Electron.
const fs = require('fs');
const path = require('path');

const MIN = 60000;
const dk = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function write(userData, data) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'frog.json'), typeof data === 'string' ? data : JSON.stringify(data));
}

// Сохранение версии 1: без onboarded/achievements/totals, 3 + 7 + 5 = 15 стаканов в истории
function v1(userData, { waterMin = 10, sitMin = 5 } = {}) {
  const now = Date.now();
  const day = (t, n) => ({ date: dk(t), drinks: n, breaks: 2, autoBreaks: 1, codingMs: 3 * 3600000, maxSitMs: 40 * MIN });
  write(userData, {
    settings: { waterEvery: 40, moveEvery: 55, breakAfter: 5, nagEvery: 10, sound: false, notify: true, scale: 1.25, launchAtLogin: false },
    pet: {
      waterMs: waterMin * MIN, sitMs: sitMin * MIN, pausedUntil: 0, nextNag: { water: 0, move: 0 }, nags: { water: 0, move: 0 },
      lastTick: now - 5000, away: false, awayStart: 0, idleSec: 0, day: day(now, 3), history: [day(now - 86400000, 7), day(now - 2 * 86400000, 5)],
    },
    pos: [100, 100], hidden: false,
  });
}

// Битые файлы: обрыв записи, не тот тип, мусор в полях
const CORRUPT = {
  truncated: '{"settings":{"waterEvery":40},"pet":{"waterMs":12',
  'wrong-types': JSON.stringify({ settings: [1, 2], pet: 'frog', achievements: 'x', graveyard: 5, onboarded: true }),
  'junk-fields': JSON.stringify({
    onboarded: true,
    settings: { waterEvery: 'abc', moveEvery: -5, scale: 'huge', nagEvery: null, sound: 'yes' },
    pet: { waterMs: 'NaN', sitMs: -100, day: 'today', history: { a: 1 }, lastTick: 'never', nextNag: null, nags: 3 },
    pos: ['x', null], achievements: { unlocked: 1 }, graveyard: 'none',
  }),
};
function corrupt(userData, kind) {
  if (!(kind in CORRUPT)) throw new Error('нет такого битого файла: ' + kind);
  write(userData, CORRUPT[kind]);
}

module.exports = { v1, corrupt, CORRUPT, write };
