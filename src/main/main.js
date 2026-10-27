const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');

// UV_THREADPOOL_SIZE must be in the environment BEFORE libuv creates its thread
// pool; Electron may touch async I/O during startup, so setting it in-process
// is a race. Dev: the npm script exports it. Packaged: relaunch once with it.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '64';
  if (app.isPackaged) {
    app.relaunch();
    app.exit(0);
  }
}
// Verification: this MUST print 64 in the terminal. If it prints undefined or 4,
// the variable did not reach the process and the thread pool is capped at 4.
console.log('[perf] UV_THREADPOOL_SIZE =', process.env.UV_THREADPOOL_SIZE);

const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DEFAULT_EXCLUSIONS } = require('./exclusions');
const { buildSession } = require('./deleteGuard');
const { checkRoots } = require('./system');
const { createDeleteService } = require('./deleteService');
const { getLocations } = require('./locations');

const isDev = process.env.NODE_ENV === 'development';

let activeWorker = null;
let lastSession = null; // deleteGuard session from the last completed scan
let exclusionList = null; // loaded from userData on first use; see loadExclusions()

function createWindow() {
  // IMPORTANT: BrowserWindow width/height are specified in DIPs (device-independent
  // pixels), and Windows/macOS already render those DIPs at the correct physical
  // pixel density via OS-level DPI scaling — a 1200-DIP-wide window looks the same
  // physical size on a 100% and a 200% display. So we must NOT multiply by
  // scaleFactor directly (that would double-scale: request more DIPs *and* have
  // the OS scale them up again, producing an oversized window on HiDPI screens).
  //
  // What we DO want: on genuinely high-resolution displays (high scaleFactor
  // generally correlates with a higher-resolution panel — 4K, Retina, etc.) the
  // user has more physical screen real estate available, so a slightly larger
  // window in DIP terms is appropriate and won't feel cramped. We apply a gentle,
  // capped multiplier rather than the raw scaleFactor for this reason.
  const { scaleFactor, workAreaSize } = screen.getPrimaryDisplay();
  const sizeFactor = 1 + Math.min(scaleFactor - 1, 1) * 0.15; // e.g. 1.0→1.0, 1.5→1.075, 2.0→1.15

  const BASE_WIDTH = 1200;
  const BASE_HEIGHT = 800;
  const BASE_MIN_WIDTH = 900;
  const BASE_MIN_HEIGHT = 600;

  // Clamp to the display's work area (DIPs) so a small/low-res screen never gets
  // asked for a window bigger than it can show.
  const width = Math.min(Math.round(BASE_WIDTH * sizeFactor), workAreaSize.width);
  const height = Math.min(Math.round(BASE_HEIGHT * sizeFactor), workAreaSize.height);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(Math.round(BASE_MIN_WIDTH * sizeFactor), workAreaSize.width),
    minHeight: Math.min(Math.round(BASE_MIN_HEIGHT * sizeFactor), workAreaSize.height),
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
ipcMain.handle('dialog:openFolder', async (_event, defaultPath) => {
  const opts = { properties: ['openDirectory', 'multiSelections'] };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:saveTextFile', async (_event, defaultName, content) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || 'report.txt',
    filters: [{ name: 'Text files', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.promises.writeFile(result.filePath, content, 'utf8');
  return true;
});

// ── IPC: Drive / network locations (async — see locations.js) ─────────────────
ipcMain.handle('fs:getLocations', async () => getLocations());

// ── IPC: Exclusion list (in-memory; persisted properly in Sprint 4) ──────────
// Exclusions persist in userData/dff-exclusions.json (written atomically).
const exclusionsPath = () => path.join(app.getPath('userData'), 'dff-exclusions.json');
async function loadExclusions() {
  if (exclusionList) return exclusionList;
  try {
    const saved = JSON.parse(await fs.promises.readFile(exclusionsPath(), 'utf8'));
    exclusionList = Array.isArray(saved) ? saved.filter(x => typeof x === 'string') : [...DEFAULT_EXCLUSIONS];
  } catch {
    exclusionList = [...DEFAULT_EXCLUSIONS];
  }
  return exclusionList;
}
async function saveExclusions(list) {
  exclusionList = list;
  const tmp = exclusionsPath() + '.tmp';
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(list, null, 2));
    await fs.promises.rename(tmp, exclusionsPath());
  } catch (e) {
    console.error('[exclusions] could not save:', e.message);
  }
  return exclusionList;
}

ipcMain.handle('exclusions:get', async () => loadExclusions());
ipcMain.handle('exclusions:set', async (_event, list) =>
  Array.isArray(list) ? saveExclusions(list.filter(x => typeof x === 'string')) : loadExclusions());
ipcMain.handle('exclusions:resetDefaults', async () => saveExclusions([...DEFAULT_EXCLUSIONS]));

ipcMain.handle('scan:checkRoots', async (_event, opts) => checkRoots(opts));

// ── IPC: Scan (worker-thread based) ───────────────────────────────────────────
ipcMain.handle('scan:start', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  // Enforced here as well as in the UI: overlapping or aliased roots can make
  // a protected file look like a deletable target copy.
  lastSession = null; // a new scan supersedes the old results
  const roots = await checkRoots(opts);
  if (roots.blocked.length > 0) {
    const reason = roots.blocked[0].reason;
    return { groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [{ path: '-', reason }], error: reason, mode: opts.mode };
  }

  const exclusions = await loadExclusions();

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
        exclusions,
        includeEmpty: !!opts.includeEmpty,
        confidence: opts.confidence, // quick | standard | thorough (worker defaults standard)
        concurrency: opts.concurrency, // undefined → worker defaults to 32
        platform: process.platform,
        rootExcludes: roots.excludeFromTarget,
        // Signature cache: (path, size, mtime) → hashes, reused across scans
        cachePath: path.join(app.getPath('userData'), 'dff-signature-cache.json'),
      },
    });
    activeWorker = worker;

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        win?.webContents.send('scan:progress', { scanned: msg.scanned, phase: msg.phase, total: msg.total, currentPath: msg.currentPath ?? '' });
      } else if (msg.type === 'done') {
        activeWorker = null;
        lastSession = buildSession(msg.result, opts, process.platform);
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
	
	worker.on('error', (err) => {
      console.error('[scan] worker error:', err);
    });

    worker.on('exit', (code) => {
      if (activeWorker === worker) {
        activeWorker = null;
        console.error('[scan] worker exited early with code', code);
        resolve({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0,
          warnings: [{ path: '-', reason: `Worker exited unexpectedly (code ${code})` }],
          error: `Worker exited unexpectedly (code ${code})` });
      }
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

// ── IPC: Delete ──────────────────────────────────────────────────────────────
// The renderer only says WHICH files. deleteService (guard + executor +
// quarantine) decides whether that's allowed and how. Never permanent.
let deleteService = null;
function getDeleteService() {
  if (!deleteService) {
    deleteService = createDeleteService({
      userDataDir: app.getPath('userData'),
      homeDir: os.homedir(),
      trash: (p) => shell.trashItem(p),
    });
  }
  return deleteService;
}

ipcMain.handle('files:cancelDelete', async () => { getDeleteService().cancel(); return true; });

ipcMain.handle('files:delete', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getDeleteService().deleteFiles(lastSession, payload, (p) => win?.webContents.send('files:deleteProgress', p));
});

// Signature cache. The worker writes a small .meta.json next to the cache, so
// the Settings page never has to parse the (possibly 100 MB) cache itself.
const sigCachePath = () => path.join(app.getPath('userData'), 'dff-signature-cache.json');

ipcMain.handle('cache:info', async () => {
  const p = sigCachePath();
  try {
    const stat = await fs.promises.stat(p);
    let entries = null;
    try { entries = JSON.parse(await fs.promises.readFile(p + '.meta.json', 'utf8')).entries; } catch { /* older cache: unknown */ }
    return { exists: true, bytes: stat.size, entries };
  } catch {
    return { exists: false, bytes: 0, entries: 0 };
  }
});

ipcMain.handle('cache:clear', async () => {
  try {
    await fs.promises.rm(sigCachePath(), { force: true });
    await fs.promises.rm(sigCachePath() + '.meta.json', { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('files:getQuarantineManifest', async () => getDeleteService().listQuarantine());

ipcMain.handle('files:restoreFromQuarantine', async (_event, quarantinePath) => getDeleteService().restore(quarantinePath));

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
