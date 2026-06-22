const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder:       (defaultPath) => ipcRenderer.invoke('dialog:openFolder', defaultPath),
  getLocations:     ()       => ipcRenderer.invoke('fs:getLocations'),
  listDirectory:    (path)   => ipcRenderer.invoke('fs:listDirectory', path),

  startScan:        (opts)   => ipcRenderer.invoke('scan:start', opts),
  cancelScan:       ()       => ipcRenderer.invoke('scan:cancel'),
  onScanProgress:   (cb)     => ipcRenderer.on('scan:progress', (_, data) => cb(data)),
  removeScanProgress: ()     => ipcRenderer.removeAllListeners('scan:progress'),

  deleteFiles:      (paths)  => ipcRenderer.invoke('files:delete', paths),
  getQuarantineManifest: ()  => ipcRenderer.invoke('files:getQuarantineManifest'),
  restoreFromQuarantine: (quarantinePath) => ipcRenderer.invoke('files:restoreFromQuarantine', quarantinePath),

  getExclusions:    ()       => ipcRenderer.invoke('exclusions:get'),
  setExclusions:    (list)   => ipcRenderer.invoke('exclusions:set', list),
  resetExclusions:  ()       => ipcRenderer.invoke('exclusions:resetDefaults'),

  windowMinimize:   ()       => ipcRenderer.send('window:minimize'),
  windowMaximize:   ()       => ipcRenderer.send('window:maximize'),
  windowClose:      ()       => ipcRenderer.send('window:close'),
});
