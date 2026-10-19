// node mkv1.js <dir> <waterMin> <sitMin>
const fs = require('fs'), path = require('path');
const [dir, wm, sm] = process.argv.slice(2);
const now = Date.now(), MIN = 60000;
const dk = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const day = (t, n) => ({ date: dk(t), drinks: n, breaks: 2, autoBreaks: 1, codingMs: 3 * 3600000, maxSitMs: 40 * MIN });
const data = {
  settings: { waterEvery: 40, moveEvery: 55, breakAfter: 5, nagEvery: 10, sound: false, notify: true, scale: 1.25, launchAtLogin: false },
  pet: { waterMs: wm * MIN, sitMs: sm * MIN, pausedUntil: 0, nextNag: { water: 0, move: 0 }, nags: { water: 0, move: 0 },
    lastTick: now - 5000, away: false, awayStart: 0, idleSec: 0, day: day(now, 3), history: [day(now - 86400000, 7), day(now - 2 * 86400000, 5)] },
  pos: [100, 100], hidden: false,
};
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'frog.json'), JSON.stringify(data));
