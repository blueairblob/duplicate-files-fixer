const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  startScan: (opts) => ipcRenderer.invoke('scan:start', opts),
  deleteFiles: (paths) => ipcRenderer.invoke('files:delete', paths),
  statFile: (path) => ipcRenderer.invoke('files:stat', path),
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_, data) => cb(data)),
  removeScanProgress: () => ipcRenderer.removeAllListeners('scan:progress'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
});
