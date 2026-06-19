const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DEFAULT_EXCLUSIONS } = require('./exclusions');

const isDev = process.env.NODE_ENV === 'development';

let activeWorker = null;
let exclusionList = [...DEFAULT_EXCLUSIONS]; // in-memory for the prototype; Sprint 4 persists this via electron-store

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f14',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Pick folder ──────────────────────────────────────────────────────────
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

// ── IPC: Get network/drive locations ─────────────────────────────────────────
ipcMain.handle('fs:getLocations', async () => {
  const locations = [];

  locations.push({ label: 'Home', path: os.homedir(), icon: 'home' });

  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
    const p = path.join(os.homedir(), name);
    try {
      fs.accessSync(p);
      locations.push({ label: name, path: p, icon: name.toLowerCase() });
    } catch {}
  }

  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      const out = execSync('wmic logicaldisk get name,drivetype,description /format:csv', { encoding: 'utf8' });
      for (const line of out.split('\n').slice(2)) {
        const parts = line.trim().split(',');
        if (parts.length >= 4) {
          const [, desc, driveType, name] = parts;
          if (!name) continue;
          const drivePath = name.trim() + '\\';
          const type = parseInt(driveType);
          let icon = 'drive';
          if (type === 3) icon = 'hdd';
          if (type === 4) icon = 'network';
          if (type === 2) icon = 'usb';
          if (type === 5) icon = 'disc';
          locations.push({ label: `${desc.trim() || drivePath} (${drivePath})`, path: drivePath, icon });
        }
      }
    } catch {}

    try {
      const { execSync } = require('child_process');
      const netOut = execSync('net use', { encoding: 'utf8' });
      for (const line of netOut.split('\n')) {
        const match = line.match(/([A-Z]:)\s+(\\\\\S+)/);
        if (match) {
          locations.push({ label: `Network: ${match[2]} (${match[1]})`, path: match[1] + '\\', icon: 'network' });
        }
      }
    } catch {}

  } else {
    for (const base of ['/media', '/mnt', '/run/media']) {
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const mp = path.join(base, e.name);
            try {
              fs.readdirSync(mp);
              locations.push({ label: `${e.name} (${mp})`, path: mp, icon: 'usb' });
            } catch {}
          }
        }
      } catch {}
    }

    if (process.platform === 'darwin') {
      try {
        const vols = fs.readdirSync('/Volumes', { withFileTypes: true });
        for (const v of vols) {
          if (v.isDirectory() || v.isSymbolicLink()) {
            locations.push({ label: v.name, path: `/Volumes/${v.name}`, icon: 'drive' });
          }
        }
      } catch {}
    }

    try {
      const fstab = fs.readFileSync('/etc/fstab', 'utf8');
      for (const line of fstab.split('\n')) {
        if (line.startsWith('//') || line.startsWith('nfs')) {
          const parts = line.trim().split(/\s+/);
          if (parts[1] && parts[1].startsWith('/')) {
            locations.push({ label: `Network: ${parts[0]} → ${parts[1]}`, path: parts[1], icon: 'network' });
          }
        }
      }
    } catch {}
  }

  return locations;
});

// ── IPC: Exclusion list (in-memory; persisted properly in Sprint 4) ──────────
ipcMain.handle('exclusions:get', async () => exclusionList);

ipcMain.handle('exclusions:set', async (event, list) => {
  exclusionList = Array.isArray(list) ? list : exclusionList;
  return exclusionList;
});

ipcMain.handle('exclusions:resetDefaults', async () => {
  exclusionList = [...DEFAULT_EXCLUSIONS];
  return exclusionList;
});

// ── IPC: Scan (worker-thread based) ───────────────────────────────────────────
ipcMain.handle('scan:start', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  return new Promise((resolve) => {
    if (activeWorker) {
      try { activeWorker.terminate(); } catch {}
      activeWorker = null;
    }

    const worker = new Worker(path.join(__dirname, 'scanWorker.js'), {
      workerData: {
        mode: opts.mode,
        protectedFolders: opts.protectedFolders || [],
        targetFolders: opts.targetFolders || [],
        filters: opts.filters || {},
        autoMarkRule: opts.autoMarkRule,
        exclusions: exclusionList,
        includeEmpty: !!opts.includeEmpty,
      },
    });
    activeWorker = worker;

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        win?.webContents.send('scan:progress', { scanned: msg.scanned, phase: msg.phase, total: msg.total });
      } else if (msg.type === 'done') {
        activeWorker = null;
        resolve(msg.result);
      } else if (msg.type === 'cancelled') {
        activeWorker = null;
        resolve({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [], cancelled: true });
      } else if (msg.type === 'error') {
        activeWorker = null;
        resolve({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [{ path: '-', reason: msg.message }], error: msg.message });
      }
    });

    worker.on('error', (err) => {
      activeWorker = null;
      resolve({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [{ path: '-', reason: err.message }], error: err.message });
    });
  });
});

ipcMain.handle('scan:cancel', async () => {
  if (activeWorker) {
    activeWorker.postMessage({ type: 'cancel' });
    return true;
  }
  return false;
});

// ── IPC: Delete with Linux trash fallback + quarantine manifest ──────────────
const QUARANTINE_DIR = path.join(os.homedir(), '.dff-quarantine');
const MANIFEST_PATH = path.join(QUARANTINE_DIR, 'manifest.json');

function ensureQuarantineDir() {
  try {
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  } catch {}
}

function appendManifest(entry) {
  ensureQuarantineDir();
  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {}
  manifest.push(entry);
  try {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {}
}

function quarantineFile(filePath) {
  ensureQuarantineDir();
  const basename = path.basename(filePath);
  const stamp = Date.now();
  const quarantinedName = `${stamp}_${basename}`;
  const destPath = path.join(QUARANTINE_DIR, quarantinedName);
  fs.renameSync(filePath, destPath);
  appendManifest({
    originalPath: filePath,
    quarantinePath: destPath,
    deletedAt: new Date().toISOString(),
  });
  return destPath;
}

ipcMain.handle('files:delete', async (event, filePaths) => {
  const results = { deleted: [], failed: [], quarantined: [] };
  for (const filePath of filePaths) {
    // 1. Try the OS trash first (works reliably on Windows/macOS, often fails on Linux/WSL)
    try {
      await shell.trashItem(filePath);
      results.deleted.push(filePath);
      continue;
    } catch {
      // fall through to quarantine fallback
    }

    // 2. Fallback: move to in-app quarantine folder with a manifest entry, recoverable
    try {
      quarantineFile(filePath);
      results.deleted.push(filePath);
      results.quarantined.push(filePath);
      continue;
    } catch {
      // fall through to last-resort permanent delete
    }

    // 3. Last resort: permanent delete (only reached if both trash and quarantine fail,
    //    e.g. cross-device rename error or a read-only filesystem)
    try {
      fs.unlinkSync(filePath);
      results.deleted.push(filePath);
    } catch (e) {
      results.failed.push({ path: filePath, error: e.message });
    }
  }
  return results;
});

ipcMain.handle('files:getQuarantineManifest', async () => {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return [];
  }
});

ipcMain.handle('files:restoreFromQuarantine', async (event, quarantinePath) => {
  try {
    let manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const entry = manifest.find(e => e.quarantinePath === quarantinePath);
    if (!entry) return { success: false, error: 'Not found in manifest' };

    fs.renameSync(entry.quarantinePath, entry.originalPath);
    manifest = manifest.filter(e => e.quarantinePath !== quarantinePath);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
