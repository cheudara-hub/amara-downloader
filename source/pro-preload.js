const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('amaraDesktop', {
  version: process.argv.find(value => value.startsWith('--amara-app-version='))?.slice('--amara-app-version='.length),
  origin: process.argv.find(value => value.startsWith('--amara-pro-origin='))?.slice('--amara-pro-origin='.length),
  call: (command, payload) => ipcRenderer.invoke('amara-pro-command', command, payload),
  onRoute: callback => ipcRenderer.on('amara-pro-route', (_event, route) => callback(route)),
});
