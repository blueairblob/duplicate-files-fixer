const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder:       (defaultPath) => ipcRenderer.invoke('dialog:openFolder', defaultPath),
  // File.path was removed in Electron 32; this is the supported replacement.
  getPathForFile:   (file)   => webUtils.getPathForFile(file),
  getLocations:     ()       => ipcRenderer.invoke('fs:getLocations'),

  checkRoots:       (opts)   => ipcRenderer.invoke('scan:checkRoots', opts),
  startScan:        (opts)   => ipcRenderer.invoke('scan:start', opts),
  cancelScan:       ()       => ipcRenderer.invoke('scan:cancel'),
  onScanProgress:   (cb)     => ipcRenderer.on('scan:progress', (_, data) => cb(data)),
  removeScanProgress: ()     => ipcRenderer.removeAllListeners('scan:progress'),

  deleteFiles:      (req)    => ipcRenderer.invoke('files:delete', req),
  cancelDelete:     ()       => ipcRenderer.invoke('files:cancelDelete'),
  onDeleteProgress: (cb)     => ipcRenderer.on('files:deleteProgress', (_, data) => cb(data)),
  removeDeleteProgress: ()   => ipcRenderer.removeAllListeners('files:deleteProgress'),
  getQuarantineManifest: ()  => ipcRenderer.invoke('files:getQuarantineManifest'),
  restoreFromQuarantine: (quarantinePath) => ipcRenderer.invoke('files:restoreFromQuarantine', quarantinePath),

  getCacheInfo:     ()       => ipcRenderer.invoke('cache:info'),
  clearCache:       ()       => ipcRenderer.invoke('cache:clear'),

  getExclusions:    ()       => ipcRenderer.invoke('exclusions:get'),
  setExclusions:    (list)   => ipcRenderer.invoke('exclusions:set', list),
  resetExclusions:  ()       => ipcRenderer.invoke('exclusions:resetDefaults'),

  saveTextFile:     (defaultName, content) => ipcRenderer.invoke('dialog:saveTextFile', defaultName, content),

  windowMinimize:   ()       => ipcRenderer.send('window:minimize'),
  windowMaximize:   ()       => ipcRenderer.send('window:maximize'),
  windowClose:      ()       => ipcRenderer.send('window:close'),
});
