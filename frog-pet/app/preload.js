'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('frog', {
  init: () => ipcRenderer.invoke('init'),
  onView: on('view'),
  onEvent: on('event'),
  onCursor: on('cursor'),
  onSettings: on('settings'),
  action: (type, opts) => ipcRenderer.send('action', Object.assign({}, opts || {}, { type })),
  setIgnore: (v) => ipcRenderer.send('ignore', v),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
});
