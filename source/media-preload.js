const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mediaBrowser', {
  call: (command, payload) => ipcRenderer.invoke('media-browser-command', command, payload),
  onState: callback => ipcRenderer.on('media-browser-state', (_event, state) => callback(state)),
});
