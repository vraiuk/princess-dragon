'use strict';
// Мост для окон приложения (трофеи, настройки, приветствие): window.frogApp
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frogApp', {
  getData: () => ipcRenderer.invoke('app:get'),
  onUpdate: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('app:update', h);
    return () => ipcRenderer.removeListener('app:update', h);
  },
  setSetting: (key, value) => ipcRenderer.send('app:set', key, value),
  action: (type, opts) => ipcRenderer.send('app:action', Object.assign({}, opts || {}, { type })),
  open: (name) => ipcRenderer.send('app:open', name),
  finishOnboarding: () => ipcRenderer.send('app:onboarded'),
  close: () => ipcRenderer.send('app:close'),
});
