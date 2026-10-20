'use strict';
// Общие помощники для e2e-сценариев. Выполняется в main-процессе Electron (через FROG_TEST_SCRIPT).
// Протокол вывода, который читает qa/e2e/run.js:
//   [ok] <что проверили>      — проверка прошла
//   [FAIL] <что проверили>    — проверка упала
//   [result] ALL OK | N FAIL   — итог фазы, после него приложение выходит
const fs = require('fs');
const path = require('path');
const { app, Notification } = require('electron');

// Уведомления перехватываем: на Linux без dbus их нет, а нам важно, что приложение их отправило
const notes = [];
try { Notification.isSupported = () => true; } catch (e) { console.log('cant patch Notification.isSupported', e.message); }
Notification.prototype.show = function () { notes.push(this.title + ' | ' + this.body); console.log('[note]', this.title); };

let fails = 0;
const H = {
  notes,
  phase: process.env.E2E_PHASE || '',
  appRoot: path.resolve(__dirname, '..', '..'),
  // файлы между фазами сценария лежат во временном каталоге сценария, не рядом со скриптами
  side(name) {
    const dir = process.env.E2E_TMP;
    if (!dir) throw new Error('E2E_TMP не задан: запускай через node qa/e2e/run.js');
    return path.join(dir, name);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, ms = 5000, step = 100) {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await H.sleep(step); }
  },
  ok(c, msg) { if (c) console.log('[ok]', msg); else { fails++; console.log('[FAIL]', msg); } },
  exec: (w, js) => w.webContents.executeJavaScript(js),
  file(api) { try { return JSON.parse(fs.readFileSync(api.storePath(), 'utf8')); } catch (e) { return 'ERR ' + e.message; } },
  done() { console.log(fails ? `[result] ${fails} FAIL` : '[result] ALL OK'); setTimeout(() => app.quit(), 200); },
  trayTitle(api) {
    const t = api.tray;
    if (!t.__p) { t.__p = 1; const o = t.setTitle.bind(t); t.setTitle = (s) => { t.__title = s; o(s); }; }
    return t.__title;
  },
  // меню и подсказка трея: последние значения setContextMenu / setToolTip
  trayMenu(api) {
    const t = api.tray;
    if (!t.__pm) {
      t.__pm = 1;
      const m = t.setContextMenu.bind(t), tt = t.setToolTip.bind(t);
      t.setContextMenu = (x) => { t.__menu = x; m(x); };
      t.setToolTip = (s) => { t.__tip = s; tt(s); };
    }
    return t;
  },
  // всё, что main отправил в окно: [[канал, данные, время], ...]
  spySend(w) {
    const wc = w.webContents;
    if (!wc.__sent) {
      wc.__sent = [];
      const o = wc.send.bind(wc);
      wc.send = (ch, ...a) => { wc.__sent.push([ch, a[0], Date.now()]); return o(ch, ...a); };
    }
    return wc.__sent;
  },
  // промис с таймаутом: executeJavaScript в упавшем или ушедшем окне может не вернуться никогда
  within: (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]),
  // окно целиком внутри рабочей области своего экрана
  onScreen(b) {
    const a = require('electron').screen.getDisplayMatching(b).workArea;
    return b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
  },
};
module.exports = H;
