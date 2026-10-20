#!/usr/bin/env node
// Проверка fuses Electron в собранном приложении (CI, после electron-builder).
// Ожидаемые значения берутся из package.json → build.electronFuses.
// В universal-бинаре два слайса и два fuse wire: проверяем каждый.
//   node build/check-fuses.js dist/mac-universal/Zhabka.app [--slices=2]
'use strict';
const fs = require('fs');
const path = require('path');

const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'); // @electron/fuses constants
const ORDER = [ // FuseV1Options, порядок в wire
  'runAsNode',
  'enableCookieEncryption',
  'enableNodeOptionsEnvironmentVariable',
  'enableNodeCliInspectArguments',
  'enableEmbeddedAsarIntegrityValidation',
  'onlyLoadAppFromAsar',
  'loadBrowserProcessSpecificV8Snapshot',
  'grantFileProtocolExtraPrivileges',
];
const STATE = { 48: 'off', 49: 'on', 114: 'removed' };

const app = process.argv[2];
const slicesArg = process.argv.find((a) => a.startsWith('--slices='));
const wantSlices = slicesArg ? Number(slicesArg.split('=')[1]) : 0;
if (!app) {
  console.error('usage: check-fuses.js <App.app | electron binary> [--slices=N]');
  process.exit(2);
}
const bin = app.endsWith('.app')
  ? path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')
  : app;
const expected = require('../package.json').build.electronFuses;
const buf = fs.readFileSync(bin);

const wires = [];
for (let i = buf.indexOf(SENTINEL); i !== -1; i = buf.indexOf(SENTINEL, i + 1)) {
  const at = i + SENTINEL.length;
  wires.push({ version: buf[at], len: buf[at + 1], fuses: buf.subarray(at + 2, at + 2 + buf[at + 1]) });
}

let bad = 0;
if (!wires.length) { console.error('fuse wire не найден в', bin); process.exit(1); }
if (wantSlices && wires.length !== wantSlices) {
  console.error(`ожидалось слайсов: ${wantSlices}, найдено fuse wire: ${wires.length}`);
  bad++;
}
wires.forEach((w, n) => {
  console.log(`slice ${n + 1}: fuse wire v${w.version}, ${w.len} fuses`);
  if (w.version !== 1) { console.error('  неизвестная версия wire'); bad++; return; }
  ORDER.forEach((name, idx) => {
    if (idx >= w.len) return;
    const got = STATE[w.fuses[idx]] || `?${w.fuses[idx]}`;
    const want = name in expected ? (expected[name] ? 'on' : 'off') : null;
    const ok = want === null || got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${name}: ${got}${want && !ok ? ` (ожидалось ${want})` : ''}`);
  });
  for (const name of Object.keys(expected)) {
    if (ORDER.indexOf(name) >= w.len) { console.error(`  BAD ${name}: нет в wire`); bad++; }
  }
});
if (bad) { console.error(`fuses: ошибок ${bad}`); process.exit(1); }
console.log('fuses: всё как в package.json');
