'use strict';
const fs = require('fs');
const { app, Notification } = require('electron');
const notes = [];
console.log('isSupported', Notification.isSupported()); try { Notification.isSupported = () => true; } catch (e) { console.log('cant patch', e.message); }
const origShow = Notification.prototype.show;
Notification.prototype.show = function () { notes.push(this.title + ' | ' + this.body); console.log('[note]', this.title); };
let fails = 0;
const H = {
  notes,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  ok(c, msg) { if (c) console.log('[ok]', msg); else { fails++; console.log('[FAIL]', msg); } },
  exec: (w, js) => w.webContents.executeJavaScript(js),
  file(api) { try { return JSON.parse(fs.readFileSync(api.storePath(), 'utf8')); } catch (e) { return 'ERR ' + e.message; } },
  done() { console.log(fails ? `[result] ${fails} FAIL` : '[result] ALL OK'); setTimeout(() => app.quit(), 200); },
  trayTitle(api) { const t = api.tray; if (!t.__p) { t.__p = 1; const o = t.setTitle.bind(t); t.setTitle = (s) => { t.__title = s; o(s); }; } return t.__title; },
};
module.exports = H;
