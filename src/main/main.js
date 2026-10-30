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
const { createDeleteService, hashFull } = require('./deleteService');
const { executeCopy } = require('./copyFiles');
const { normaliseRoot, isInside } = require('./roots');
const { getLocations, getRemovableDevices } = require('./locations');
const { RECORD_NAME, serializeRecord, parseRecord, compareRecord } = require('./integrity');
const { makeAppUrlCheck, hardenWebContents, denyAllPermissions } = require('./security');
const { migrateUserData } = require('./migrate');

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';
const INDEX_PATH = path.join(__dirname, '../../dist/index.html');
// Worker threads can't load from inside app.asar; package.json unpacks
// src/main (the worker and the modules it requires) next to it.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const WORKER_PATH = unpacked(path.join(__dirname, 'scanWorker.js'));
const INTEGRITY_WORKER_PATH = unpacked(path.join(__dirname, 'integrityWorker.js'));
// HOLDFAST_SMOKE=1: load the built page in a hidden window, run one real scan,
// print the result and exit (used by `npm run smoke` and CI).
const SMOKE = process.env.HOLDFAST_SMOKE === '1';
// The smoke test gets its own throwaway userData (cache, exclusions,
// quarantine registry), so running it never touches the real app's state.
// Electron keeps this folder locked while running, so it's emptied at the
// start of the next run rather than at exit.
const SMOKE_USERDATA = SMOKE ? path.join(os.tmpdir(), 'holdfast-smoke-userdata') : null;
if (SMOKE) {
  try { fs.rmSync(SMOKE_USERDATA, { recursive: true, force: true }); } catch { /* still locked by an old run */ }
  app.setPath('userData', SMOKE_USERDATA);
} else {
  // First start after the rename: copy data from the placeholder-name
  // app-data folder (cache, exclusions, quarantine registry, settings).
  try {
    const m = migrateUserData({ appDataDir: app.getPath('appData'), userDataDir: app.getPath('userData') });
    if (m.copied.length) console.log('[migrate] carried over:', m.copied.join(', '));
  } catch (e) { console.error('[migrate] failed:', e.message); }
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
let lastMove = null;    // Move to backup: plan, and what has been copied + verified
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

// ── Smoke test (HOLDFAST_SMOKE=1) ─────────────────────────────────────────────────
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-smoke-'));
  const P = {
    dir,
    src: path.join(dir, 'src'),
    tgt: path.join(dir, 'tgt'),
    srcA: path.join(dir, 'src', 'a.jpg'),
    tgtCopy: path.join(dir, 'tgt', 'a copy.jpg'),
    phone: path.join(dir, 'phone'),
    backup: path.join(dir, 'backup'),
    archive: path.join(dir, 'archive'),
  };
  try {
    fs.mkdirSync(P.src); fs.mkdirSync(P.tgt);
    fs.writeFileSync(P.srcA, 'same bytes');
    fs.writeFileSync(P.tgtCopy, 'same bytes');
    fs.writeFileSync(path.join(P.tgt, 'b.jpg'), 'different');
    fs.mkdirSync(P.phone); fs.mkdirSync(P.backup);
    fs.writeFileSync(path.join(P.phone, 'new.jpg'), 'only on the phone');
    fs.writeFileSync(path.join(P.phone, 'dup.jpg'), 'already backed up');
    fs.writeFileSync(path.join(P.backup, 'old.jpg'), 'already backed up');
    fs.mkdirSync(P.archive);

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

      // Move to backup: scan, copy the new file, free up both local copies.
      const mv = await api.startScan({ job: 'move', mode: 'compare', protectedFolders: [P.backup], targetFolders: [P.phone], filters: {}, confidence: 'thorough' });
      out.movePlan = mv.move && mv.move.newFiles.length === 1 && mv.move.inBackup.length === 1;
      const cp = await api.moveCopy({ layout: 'folders' });
      out.moveCopied = cp.copied.length === 1 && cp.failed.length === 0;
      const sum = await api.moveFreeUpSummary();
      const fr = await api.moveFreeUp();
      out.moveFreed = sum.files === 2 && fr.deleted.length === 2;
      return out;
    })()`).catch(e => ({ error: e.message }));
    report.ipc.filesBack = fs.existsSync(P.srcA) && fs.existsSync(P.tgtCopy);
    report.ipc.moveLanded = fs.existsSync(path.join(P.backup, 'phone', 'new.jpg')) && !fs.existsSync(path.join(P.phone, 'new.jpg'));

    // Archive: mirror the backup into the archive and write its integrity
    // record; then flip one byte (keeping size and date) and re-check.
    report.ipc.archive = await win.webContents.executeJavaScript(`(async () => {
      const P = ${JSON.stringify(P)};
      const api = window.electronAPI;
      await api.startScan({ job: 'archive', mode: 'compare', protectedFolders: [P.archive], targetFolders: [P.backup], filters: {}, confidence: 'thorough' });
      const cp = await api.moveCopy({ layout: 'folders' });
      const rec = await api.archiveRecord();
      return { copied: cp.copied.length, recorded: rec.files };
    })()`).catch(e => ({ error: e.message }));
    const victim = path.join(P.archive, 'backup', 'old.jpg');
    if (fs.existsSync(victim)) {
      const st = fs.statSync(victim);
      const buf = fs.readFileSync(victim); buf[0] ^= 0xff; fs.writeFileSync(victim, buf);
      fs.utimesSync(victim, st.atime, st.mtime);
    }
    report.ipc.archiveCheck = await win.webContents.executeJavaScript(`window.electronAPI.archiveVerify(${JSON.stringify(P.archive)}).then(r => r.counts)`).catch(e => ({ error: e.message }));
    report.scan = { groups: report.ipc.groups };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const ipc = report.ipc || {};
  const ipcOk = ipc.overlapBlocked && ipc.groups === 1 && ipc.census && ipc.protectedRefused
    && ipc.quarantined && ipc.listed && ipc.restored && ipc.exclusions && ipc.filesBack
    && ipc.movePlan && ipc.moveCopied && ipc.moveFreed && ipc.moveLanded
    && ipc.archive && ipc.archive.copied === 2 && ipc.archive.recorded === 2
    && ipc.archiveCheck && ipc.archiveCheck.corrupted === 1;
  const ok = !!(report.page && report.page.rendered && report.page.bridge && report.page.nodeHidden
    && (isDev || report.page.csp) && ipcOk && report.errors.length === 0);
  console.log('[smoke] ' + JSON.stringify(report));
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'}`);
  // Packaged Windows builds are GUI programs with no console; HOLDFAST_SMOKE_OUT
  // gives CI a file to read instead.
  if (process.env.HOLDFAST_SMOKE_OUT) fs.writeFileSync(process.env.HOLDFAST_SMOKE_OUT, JSON.stringify({ ok, ...report }, null, 2));
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
handle('fs:listDevices', async () => getRemovableDevices());

// ── IPC: Exclusion list (in-memory; persisted properly in Sprint 4) ──────────
// Exclusions persist in userData/holdfast-exclusions.json (written atomically).
const exclusionsPath = () => path.join(app.getPath('userData'), 'holdfast-exclusions.json');
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
  lastMove = null;
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
        job: opts.job,
        confidence: opts.confidence, // quick | standard | thorough (worker defaults standard)
        concurrency: opts.concurrency, // undefined → worker defaults to 32
        platform: process.platform,
        rootExcludes: roots.excludeFromTarget,
        // Signature cache: (path, size, mtime) → hashes, reused across scans
        cachePath: path.join(app.getPath('userData'), 'holdfast-signature-cache.json'),
      },
    });
    activeWorker = worker;

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        win?.webContents.send('scan:progress', { scanned: msg.scanned, phase: msg.phase, total: msg.total, currentPath: msg.currentPath ?? '' });
      } else if (msg.type === 'done') {
        activeWorker = null;
        lastSession = buildSession(msg.result, opts, process.platform);
        // Transfer jobs: copy what's new from targetFolders into the first
        // protected folder. Only Move to backup may free up the source:
        // Import never changes the device, Archive never changes the backup.
        lastMove = ['move', 'import', 'archive'].includes(opts.job) && msg.result.move
          ? { job: opts.job, toRoot: (opts.protectedFolders || [])[0], fromRoots: opts.targetFolders || [], plan: msg.result.move,
              copied: [], cleared: new Set(), allowFreeUp: opts.job === 'move' }
          : null;
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
      quarantineDirsFor: SMOKE ? (_p, file) => [path.join(file.root, '.holdfast-quarantine')] : undefined,
    });
  }
  return deleteService;
}

handle('files:cancelDelete', async () => { getDeleteService().cancel(); return true; });

// ── IPC: Move to backup ──────────────────────────────────────────────────────
// Copy the scan's new files into the backup (verified), then optionally clear
// the local copies that are verified there. The renderer only picks the
// layout and confirms; the file lists come from the main process's own plan.
let moveCancel = false;
handle('move:cancel', async () => { moveCancel = true; getDeleteService().cancel(); return true; });

handle('move:copy', async (event, { layout } = {}) => {
  if (!lastMove || !lastMove.toRoot) throw new Error('Scan results are out of date — run the scan again');
  moveCancel = false;
  const win = BrowserWindow.fromWebContents(event.sender);
  const already = new Set(lastMove.copied.map(c => c.local));
  const files = lastMove.plan.newFiles.filter(f => !already.has(f.path));
  const results = await executeCopy(files, { toRoot: lastMove.toRoot, layout: layout === 'folders' ? 'folders' : 'date' }, {
    exists: async (p) => { try { await fs.promises.access(p); return true; } catch { return false; } },
    mkdir: (d) => fs.promises.mkdir(d, { recursive: true }),
    copyFile: (a, b) => fs.promises.copyFile(a, b, fs.constants.COPYFILE_EXCL),
    hash: hashFull,
    rename: (a, b) => fs.promises.rename(a, b),
    remove: (p) => fs.promises.rm(p, { force: true }),
    setTimes: (p, iso) => fs.promises.utimes(p, new Date(iso), new Date(iso)),
    isCancelled: () => moveCancel,
    onProgress: (p) => win?.webContents.send('move:progress', { phase: 'copy', ...p }),
  });
  lastMove.copied.push(...results.copied);
  return results;
});

// Local files that are verified to exist in the backup: the ones just copied,
// plus the ones the scan found already there. Each must sit under a From
// folder and not inside the backup; executeDeletion re-hashes both copies.
function freeUpItems() {
  if (!lastMove || !lastMove.allowFreeUp) return [];
  const p = process.platform;
  const toRoot = normaliseRoot(lastMove.toRoot, p);
  const fromRoots = lastMove.fromRoots.map(r => normaliseRoot(r, p));
  const under = (file, root) => { const n = normaliseRoot(file, p); return n === root || isInside(n, root); };
  const ok = (local) => !lastMove.cleared.has(local) && fromRoots.some(r => under(local, r)) && !under(local, toRoot);
  const byPath = new Map(lastMove.plan.newFiles.map(f => [f.path, f]));
  const items = [];
  for (const c of lastMove.copied) {
    const f = byPath.get(c.local);
    if (f && ok(c.local)) items.push({ path: c.local, file: f, counterpart: c.backup, counterpartFile: null });
  }
  for (const x of lastMove.plan.inBackup) {
    if (ok(x.file.path)) items.push({ path: x.file.path, file: x.file, counterpart: x.backup, counterpartFile: null });
  }
  return items;
}

// ── IPC: Archive integrity record ─────────────────────────────────────────────
// After an Archive copy, every file in the archive is hashed into
// <archive>/holdfast-integrity.jsonl. Re-checking re-hashes every file (no
// cache) and compares, to catch silent corruption, edits, and losses.
let integrityWorker = null;
function measureFolder(root, onProgress) {
  return new Promise((resolve, reject) => {
    if (integrityWorker) { try { integrityWorker.terminate(); } catch {} }
    const w = new Worker(INTEGRITY_WORKER_PATH, { workerData: { root } });
    integrityWorker = w;
    w.on('message', (m) => {
      if (m.type === 'progress') onProgress && onProgress(m);
      else if (m.type === 'done') { integrityWorker = null; resolve({ entries: m.entries }); }
      else if (m.type === 'cancelled') { integrityWorker = null; resolve({ cancelled: true }); }
      else if (m.type === 'error') { integrityWorker = null; reject(new Error(m.message)); }
    });
    w.on('error', (e) => { integrityWorker = null; reject(e); });
  });
}
handle('archive:cancel', async () => { if (integrityWorker) integrityWorker.postMessage({ type: 'cancel' }); return true; });

handle('archive:record', async (event) => {
  if (!lastMove || lastMove.job !== 'archive') throw new Error('Run Archive backup first');
  const root = lastMove.toRoot;
  const win = BrowserWindow.fromWebContents(event.sender);
  const m = await measureFolder(root, (p) => win?.webContents.send('archive:progress', { phase: 'record', ...p }));
  if (m.cancelled) return { cancelled: true };
  const good = m.entries.filter(e => e.h);
  const target = path.join(root, RECORD_NAME);
  const tmp = target + '.tmp';
  await fs.promises.writeFile(tmp, serializeRecord(good, { root }));
  await fs.promises.rename(tmp, target);
  return { files: good.length, bytes: good.reduce((a, e) => a + e.s, 0), unreadable: m.entries.filter(e => !e.h), path: target };
});

handle('archive:verify', async (event, root) => {
  if (typeof root !== 'string' || !root) throw new Error('Choose an archive folder');
  let record;
  try { record = parseRecord(await fs.promises.readFile(path.join(root, RECORD_NAME), 'utf8')); }
  catch (e) { throw new Error(e.code === 'ENOENT' ? `No integrity record in ${root} — archive it with Holdfast first` : e.message); }
  const win = BrowserWindow.fromWebContents(event.sender);
  const m = await measureFolder(root, (p) => win?.webContents.send('archive:progress', { phase: 'verify', ...p }));
  if (m.cancelled) return { cancelled: true };
  const r = compareRecord(record.entries, m.entries);
  const cap = (a) => a.slice(0, 5000);
  return {
    root, recordedAt: record.header.createdAt, recordedFiles: record.entries.length,
    ok: r.ok.length, corrupted: cap(r.corrupted), modified: cap(r.modified), missing: cap(r.missing), added: cap(r.added), unreadable: cap(r.unreadable),
    counts: { corrupted: r.corrupted.length, modified: r.modified.length, missing: r.missing.length, added: r.added.length, unreadable: r.unreadable.length },
  };
});

handle('move:freeUpSummary', async () => {
  const items = freeUpItems();
  return { files: items.length, bytes: items.reduce((a, i) => a + (i.file.size || 0), 0) };
});

handle('move:freeUp', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const results = await getDeleteService().deleteVerifiedCopies(freeUpItems(),
    (p) => win?.webContents.send('move:progress', { phase: 'free', ...p }));
  for (const pth of results.deleted) lastMove && lastMove.cleared.add(pth);
  return results;
});

handle('files:delete', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getDeleteService().deleteFiles(lastSession, payload, (p) => win?.webContents.send('files:deleteProgress', p));
});

// Signature cache. The worker writes a small .meta.json next to the cache, so
// the Settings page never has to parse the (possibly 100 MB) cache itself.
const sigCachePath = () => path.join(app.getPath('userData'), 'holdfast-signature-cache.json');

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
