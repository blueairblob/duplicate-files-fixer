const { app, BrowserWindow, ipcMain, dialog, shell, screen, session, nativeTheme } = require('electron');

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
const { makeAppUrlCheck, hardenWebContents, denyAllPermissions } = require('./security');

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';
const INDEX_PATH = path.join(__dirname, '../../dist/index.html');
// Worker threads can't load from inside app.asar; package.json unpacks
// src/main (the worker and the modules it requires) next to it.
const WORKER_PATH = path.join(__dirname, 'scanWorker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
// DFF_SMOKE=1: load the built page in a hidden window, run one real scan,
// print the result and exit (used by `npm run smoke` and CI).
const SMOKE = process.env.DFF_SMOKE === '1';
// The smoke test gets its own throwaway userData (cache, exclusions,
// quarantine registry), so running it never touches the real app's state.
// Electron keeps this folder locked while running, so it's emptied at the
// start of the next run rather than at exit.
const SMOKE_USERDATA = SMOKE ? path.join(os.tmpdir(), 'dff-smoke-userdata') : null;
if (SMOKE) {
  try { fs.rmSync(SMOKE_USERDATA, { recursive: true, force: true }); } catch { /* still locked by an old run */ }
  app.setPath('userData', SMOKE_USERDATA);
}
const isAppUrl = makeAppUrlCheck({ isDev, devUrl: DEV_URL, indexPath: INDEX_PATH });

// IPC only from the app's own page. Wraps ipcMain.handle / ipcMain.on.
function fromApp(event) { return isAppUrl(event.senderFrame && event.senderFrame.url); }
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error(`Blocked ${channel}: request did not come from the app`);
    return fn(event, ...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => { if (fromApp(event)) fn(event, ...args); });
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isAppUrl));

let activeWorker = null;
let finishActiveScan = null; // resolves the in-flight scan:start promise
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
    show: !SMOKE,
    width,
    height,
    minWidth: Math.min(Math.round(BASE_MIN_WIDTH * sizeFactor), workAreaSize.width),
    minHeight: Math.min(Math.round(BASE_MIN_HEIGHT * sizeFactor), workAreaSize.height),
    // Matches --bg-window in index.css, so there's no dark flash in light mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f5f5f7',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(INDEX_PATH);
  }

  return win;
}

app.whenReady().then(() => {
  denyAllPermissions(session.defaultSession);
  if (SMOKE) { runSmoke().then(ok => app.exit(ok ? 0 : 1), (e) => { console.error('[smoke] crashed', e); app.exit(1); }); return; }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ── Smoke test (DFF_SMOKE=1) ─────────────────────────────────────────────────
// Proves a build works end to end without anyone looking at it: the page
// renders under the sandbox + CSP with the preload bridge and without Node,
// and the page drives the real IPC handlers — root checks, a compare scan (the
// worker loads from app.asar.unpacked when packaged), a delete the guard must
// partly refuse, quarantine listing and restore.
async function runSmoke() {
  const report = { packaged: app.isPackaged, errors: [] };
  const win = createWindow();
  win.webContents.on('console-message', (event, level, message) => {
    const lvl = event.level ?? level;
    const msg = event.message ?? message;
    if (lvl === 'error' || lvl === 3) report.errors.push(msg);
  });
  await new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_e, code, desc) => { report.errors.push(`load failed: ${code} ${desc}`); resolve(); });
  });
  for (let i = 0; i < 50; i++) {
    report.page = await win.webContents.executeJavaScript(`({
      rendered: (document.getElementById('root')?.children.length || 0) > 0,
      bridge: typeof window.electronAPI === 'object' && typeof window.electronAPI.startScan === 'function',
      nodeHidden: typeof window.require === 'undefined' && typeof window.process === 'undefined',
      csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    })`).catch(e => ({ error: e.message }));
    if (report.page.rendered) break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Drive the real preload bridge and IPC handlers from the page, the way the
  // UI does: root checks, a compare scan, a delete the guard must partly
  // refuse, then the quarantine listing and a restore.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-smoke-'));
  const P = {
    dir,
    src: path.join(dir, 'src'),
    tgt: path.join(dir, 'tgt'),
    srcA: path.join(dir, 'src', 'a.jpg'),
    tgtCopy: path.join(dir, 'tgt', 'a copy.jpg'),
  };
  try {
    fs.mkdirSync(P.src); fs.mkdirSync(P.tgt);
    fs.writeFileSync(P.srcA, 'same bytes');
    fs.writeFileSync(P.tgtCopy, 'same bytes');
    fs.writeFileSync(path.join(P.tgt, 'b.jpg'), 'different');

    report.ipc = await win.webContents.executeJavaScript(`(async () => {
      const P = ${JSON.stringify(P)};
      const api = window.electronAPI;
      const out = {};
      const overlap = await api.checkRoots({ mode: 'compare', protectedFolders: [P.dir], targetFolders: [P.src] });
      out.overlapBlocked = overlap.blocked.length === 1;
      const scan = await api.startScan({ mode: 'compare', protectedFolders: [P.src], targetFolders: [P.tgt], filters: {}, confidence: 'standard', autoMarkRule: 'protected-wins' });
      out.groups = scan.groups.length;
      out.census = !!scan.census && scan.census.matched.targetFiles === 1;
      const del = await api.deleteFiles({ files: [{ path: P.srcA }, { path: P.tgtCopy }] });
      out.protectedRefused = del.skipped.some(s => s.path === P.srcA && /Protected/.test(s.reason));
      out.quarantined = del.quarantined.length === 1 && del.quarantined[0] === P.tgtCopy && del.trashed.length === 0;
      if (!out.quarantined) out.deleteResult = { trashed: del.trashed, quarantined: del.quarantined, skipped: del.skipped, failed: del.failed };
      const list = await api.getQuarantineManifest();
      const entry = list.find(e => e.originalPath === P.tgtCopy);
      out.listed = !!entry;
      out.restored = entry ? (await api.restoreFromQuarantine(entry.quarantinePath)).success === true : false;
      const ex = await api.getExclusions();
      out.exclusions = Array.isArray(ex) && ex.length > 0;
      return out;
    })()`).catch(e => ({ error: e.message }));
    report.ipc.filesBack = fs.existsSync(P.srcA) && fs.existsSync(P.tgtCopy);
    report.scan = { groups: report.ipc.groups };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const ipc = report.ipc || {};
  const ipcOk = ipc.overlapBlocked && ipc.groups === 1 && ipc.census && ipc.protectedRefused
    && ipc.quarantined && ipc.listed && ipc.restored && ipc.exclusions && ipc.filesBack;
  const ok = !!(report.page && report.page.rendered && report.page.bridge && report.page.nodeHidden
    && (isDev || report.page.csp) && ipcOk && report.errors.length === 0);
  console.log('[smoke] ' + JSON.stringify(report));
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'}`);
  // Packaged Windows builds are GUI programs with no console; DFF_SMOKE_OUT
  // gives CI a file to read instead.
  if (process.env.DFF_SMOKE_OUT) fs.writeFileSync(process.env.DFF_SMOKE_OUT, JSON.stringify({ ok, ...report }, null, 2));
  return ok;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Pick folder ──────────────────────────────────────────────────────────
handle('dialog:openFolder', async (_event, defaultPath) => {
  const opts = { properties: ['openDirectory', 'multiSelections'] };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

handle('dialog:saveTextFile', async (_event, defaultName, content) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || 'report.txt',
    filters: [{ name: 'Text files', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.promises.writeFile(result.filePath, content, 'utf8');
  return true;
});

// ── IPC: Drive / network locations (async — see locations.js) ─────────────────
handle('fs:getLocations', async () => getLocations());

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

handle('exclusions:get', async () => loadExclusions());
handle('exclusions:set', async (_event, list) =>
  Array.isArray(list) ? saveExclusions(list.filter(x => typeof x === 'string')) : loadExclusions());
handle('exclusions:resetDefaults', async () => saveExclusions([...DEFAULT_EXCLUSIONS]));

handle('scan:checkRoots', async (_event, opts) => checkRoots(opts));

// ── IPC: Scan (worker-thread based) ───────────────────────────────────────────
handle('scan:start', async (event, opts) => {
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

  return new Promise((resolveScan) => {
    // A new scan supersedes a running one: answer the old caller first, so
    // its promise doesn't hang forever after terminate().
    if (activeWorker) {
      const old = activeWorker;
      activeWorker = null;
      if (finishActiveScan) finishActiveScan({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [], cancelled: true });
      try { old.terminate(); } catch {}
    }
    let settled = false;
    const resolve = (result) => { if (!settled) { settled = true; resolveScan(result); } };
    finishActiveScan = resolve;

    const worker = new Worker(WORKER_PATH, {
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
      console.error('[scan] worker error:', err);
      if (activeWorker === worker) activeWorker = null;
      resolve({ groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0, warnings: [{ path: '-', reason: err.message }], error: err.message });
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

handle('scan:cancel', async () => {
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
      // Smoke test: no Recycle Bin, and quarantine only inside the scan root
      // (its temp folder) — never the volume root or home folder.
      trash: SMOKE ? () => Promise.reject(new Error('smoke test: Recycle Bin disabled')) : (p) => shell.trashItem(p),
      quarantineDirsFor: SMOKE ? (_p, file) => [path.join(file.root, '.dff-quarantine')] : undefined,
    });
  }
  return deleteService;
}

handle('files:cancelDelete', async () => { getDeleteService().cancel(); return true; });

handle('files:delete', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getDeleteService().deleteFiles(lastSession, payload, (p) => win?.webContents.send('files:deleteProgress', p));
});

// Signature cache. The worker writes a small .meta.json next to the cache, so
// the Settings page never has to parse the (possibly 100 MB) cache itself.
const sigCachePath = () => path.join(app.getPath('userData'), 'dff-signature-cache.json');

handle('cache:info', async () => {
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

handle('cache:clear', async () => {
  try {
    await fs.promises.rm(sigCachePath(), { force: true });
    await fs.promises.rm(sigCachePath() + '.meta.json', { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

handle('files:getQuarantineManifest', async () => getDeleteService().listQuarantine());

handle('files:restoreFromQuarantine', async (_event, quarantinePath) => getDeleteService().restore(quarantinePath));

// ── IPC: Window controls ──────────────────────────────────────────────────────
on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
