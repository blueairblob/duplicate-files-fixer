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

  moveCopy:         (opts)   => ipcRenderer.invoke('move:copy', opts),
  moveCancel:       ()       => ipcRenderer.invoke('move:cancel'),
  moveFreeUpSummary: ()      => ipcRenderer.invoke('move:freeUpSummary'),
  moveFreeUp:       ()       => ipcRenderer.invoke('move:freeUp'),
  onMoveProgress:   (cb)     => ipcRenderer.on('move:progress', (_, data) => cb(data)),
  removeMoveProgress: ()     => ipcRenderer.removeAllListeners('move:progress'),

  listDevices:      ()       => ipcRenderer.invoke('fs:listDevices'),
  archiveRecord:    ()       => ipcRenderer.invoke('archive:record'),
  archiveVerify:    (root)   => ipcRenderer.invoke('archive:verify', root),
  archiveCancel:    ()       => ipcRenderer.invoke('archive:cancel'),
  onArchiveProgress: (cb)    => ipcRenderer.on('archive:progress', (_, data) => cb(data)),
  removeArchiveProgress: ()  => ipcRenderer.removeAllListeners('archive:progress'),
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
