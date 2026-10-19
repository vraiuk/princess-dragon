#!/usr/bin/env node
'use strict';
// Прогон e2e-сценариев в настоящем Electron.
//   node qa/e2e/run.js                    # все сценарии из scenarios.js
//   node qa/e2e/run.js onboarding death   # только эти
//   node qa/e2e/run.js --list             # список сценариев и фаз
//   опции: --app <dir> (каталог приложения, по умолчанию frog-pet), --out <dir> (по умолчанию qa/out),
//          --keep (не удалять временные HOME), --timeout <мс> (на фазу, по умолчанию 60000)
// Каждый сценарий получает чистый временный HOME; фазы — последовательные запуски Electron в нём.
// На Linux запуск через `xvfb-run -a` (отключить: E2E_NO_XVFB=1), на macOS — напрямую.
// Фаза прошла, если: процесс вышел с кодом 0 и без таймаута, есть хотя бы один [ok], нет [FAIL],
// напечатан [result] ALL OK, нет падений рендера/preload и все node-проверки фазы (check) прошли.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const APP = path.resolve(opt('--app', REPO));
const OUT = path.resolve(opt('--out', path.join(REPO, 'qa', 'out')));
const DEFAULT_TIMEOUT = Number(opt('--timeout', 60000));
const KEEP = flag('--keep');
const LIST = flag('--list');
const only = argv.filter((a) => !a.startsWith('--'));

const SCENARIOS = require('./scenarios');
if (LIST) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(20)} ${s.script.padEnd(22)} ${s.phases.map((p) => p.name).join(' → ')}`);
  process.exit(0);
}
const unknown = only.filter((n) => !SCENARIOS.some((s) => s.name === n));
if (unknown.length) { console.error('нет таких сценариев:', unknown.join(', '), '\nесть:', SCENARIOS.map((s) => s.name).join(', ')); process.exit(2); }
const selected = only.length ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;

const electronBin = require(require.resolve('electron', { paths: [APP, REPO] }));
const productName = (() => { const p = require(path.join(APP, 'package.json')); return p.productName || p.name; })();
const useXvfb = process.platform === 'linux' && !process.env.E2E_NO_XVFB;
const userDataOf = (home) => (process.platform === 'darwin'
  ? path.join(home, 'Library', 'Application Support', productName)
  : process.platform === 'win32' ? path.join(home, 'AppData', 'Roaming', productName)
    : path.join(home, '.config', productName));

// шум Chromium в контейнерах без dbus/GPU — в логе оставляем, в консоль не выводим
const NOISE = /dbus|viz_main_impl|gpu_init|Fontconfig|libva|ERROR:ui\/gl|object_proxy|GLib-GIO|Gtk-WARNING|org\.freedesktop|bus\.cc|xkbcomp|_XSERVTransmkdir|Could not resolve keysym/;
// признаки поломки, которые валят фазу даже при [result] ALL OK
const CRASH = /\[test\] FAIL|\[renderer gone\]|\[preload error\]|\[renderer error\]|Uncaught |UnhandledPromiseRejection/;

function launch({ env, script, logFile, timeout, onLine }) {
  const args = [electronBin, APP, '--no-sandbox'];
  const cmd = useXvfb ? 'xvfb-run' : args.shift();
  const fullArgs = useXvfb ? ['-a', '-s', '-screen 0 1920x1080x24', ...args] : args;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, fullArgs, { cwd: APP, env: { ...env, FROG_TEST_SCRIPT: script || '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const log = fs.createWriteStream(logFile);
    const lines = [];
    let timedOut = false;
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* уже вышел */ } } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000); }, timeout);
    const feed = (stream) => {
      let buf = '';
      stream.on('data', (d) => {
        log.write(d);
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); lines.push(line); if (onLine) onLine(line, child); }
      });
      stream.on('end', () => { if (buf) { lines.push(buf); if (onLine) onLine(buf, child); } });
    };
    feed(child.stdout); feed(child.stderr);
    child.on('error', (e) => { lines.push('[spawn error] ' + e.message); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      log.end();
      resolve({ code, signal, timedOut, lines, ms: Date.now() - t0 });
    });
  });
}

async function runPhase(sc, phase, ctx) {
  const timeout = phase.timeout || DEFAULT_TIMEOUT;
  const env = { ...process.env, ...ctx.env, ...(phase.env || {}), E2E_PHASE: phase.name };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const logFile = path.join(ctx.logDir, `${sc.name}.${phase.name}.log`);
  if (phase.setup) await phase.setup(ctx);

  let second = null;
  const onLine = phase.second ? (line) => {
    if (second || !/^\[ready\]/.test(line)) return;
    const sEnv = { ...env, E2E_PHASE: phase.name + '-second' };
    const before = fs.existsSync(ctx.storePath) ? fs.readFileSync(ctx.storePath, 'utf8') : null;
    second = launch({ env: sEnv, script: '', logFile: logFile.replace(/\.log$/, '.second.log'), timeout: phase.second.timeout || 20000 })
      .then((r) => ({ ...r, before }));
  } : null;

  const r = await launch({ env, script: path.join(HERE, sc.script), logFile, timeout, onLine });
  const ok = r.lines.filter((l) => l.startsWith('[ok]'));
  const failLines = r.lines.filter((l) => l.startsWith('[FAIL]'));
  const result = r.lines.find((l) => l.startsWith('[result]'));
  const crash = r.lines.filter((l) => CRASH.test(l));
  const problems = [];
  if (r.timedOut) problems.push(`timeout ${timeout} мс`);
  else if (r.code !== 0) problems.push(`exit code ${r.code}${r.signal ? ' ' + r.signal : ''}`);
  if (!ok.length) problems.push('ни одной проверки [ok]');
  if (!result) problems.push('нет строки [result]');
  else if (!/ALL OK/.test(result)) problems.push(result);
  problems.push(...failLines, ...crash.map((l) => 'crash: ' + l.trim()));

  const checks = [];
  if (phase.second) {
    const s = second ? await second : null;
    if (!s) checks.push([false, 'second instance launched ([ready] not seen)']);
    else {
      checks.push([!s.timedOut && s.code === (phase.second.expectExit ?? 0), `second instance exited by itself, code ${s.code}${s.timedOut ? ' (timeout)' : ''}, ${s.ms} мс`]);
      checks.push([!s.lines.some((l) => CRASH.test(l)), 'second instance without crashes']);
    }
  }
  if (phase.check) checks.push(...(await phase.check(ctx)));
  for (const [c, msg] of checks) {
    const line = `${c ? '[ok]' : '[FAIL]'} (node) ${msg}`;
    fs.appendFileSync(logFile, line + '\n');
    if (c) ok.push(line); else problems.push(line);
  }
  return { phase: phase.name, ok: problems.length === 0, checks: ok.length, problems, ms: r.ms, log: path.relative(REPO, logFile) };
}

async function runScenario(sc, logDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `frog-e2e-${sc.name}-`));
  const home = path.join(tmp, 'home');
  const side = path.join(tmp, 'side');
  fs.mkdirSync(home); fs.mkdirSync(side);
  const userData = userDataOf(home);
  const env = { HOME: home, FROG_DEBUG: '1', E2E_TMP: side, XDG_CONFIG_HOME: path.join(home, '.config') };
  for (const k of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'ELECTRON_RUN_AS_NODE', 'FROG_SNAPSHOT', 'FROG_SHOWCASE']) env[k] = undefined;
  const ctx = { tmp, home, side, userData, storePath: path.join(userData, 'frog.json'), env, logDir };
  const res = { scenario: sc.name, script: sc.script, tmp, phases: [], ok: true, ms: 0 };
  for (const phase of sc.phases) {
    if (!res.ok) { res.phases.push({ phase: phase.name, ok: false, skipped: true, problems: ['пропущено: упала предыдущая фаза'] }); continue; }
    const p = await runPhase(sc, phase, ctx);
    res.phases.push(p);
    res.ms += p.ms;
    res.ok = res.ok && p.ok;
    console.log(`  ${p.ok ? 'ok  ' : 'FAIL'} ${sc.name} / ${phase.name}  (${p.checks} проверок, ${(p.ms / 1000).toFixed(1)} с)`);
    for (const pr of p.problems) console.log('       ' + pr);
  }
  if (res.ok && !KEEP) { fs.rmSync(tmp, { recursive: true, force: true }); delete res.tmp; } else console.log(`       HOME сохранён: ${tmp}`);
  return res;
}

(async () => {
  const logDir = path.join(OUT, 'e2e');
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`e2e: ${selected.length} сценариев, electron ${path.relative(REPO, electronBin)}, ${useXvfb ? 'xvfb-run' : 'без xvfb'}`);
  const t0 = Date.now();
  const results = [];
  for (const sc of selected) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runScenario(sc, logDir));
  }
  const failed = results.filter((r) => !r.ok);
  const report = {
    passed: results.length - failed.length, failed: failed.length, ms: Date.now() - t0,
    platform: process.platform, app: APP, scenarios: results,
  };
  fs.writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(`\ne2e: ${report.passed}/${results.length} сценариев прошли за ${(report.ms / 1000).toFixed(0)} с${failed.length ? '; упали: ' + failed.map((r) => r.scenario).join(', ') : ''}`);
  console.log(`отчёт: ${path.relative(process.cwd(), path.join(OUT, 'e2e-report.json'))}, логи: ${path.relative(process.cwd(), logDir)}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
