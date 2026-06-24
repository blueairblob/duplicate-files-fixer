const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DEFAULT_EXCLUSIONS } = require('./exclusions');

const isDev = process.env.NODE_ENV === 'development';

let activeWorker = null;
let exclusionList = [...DEFAULT_EXCLUSIONS]; // in-memory for the prototype; Sprint 4 persists this via electron-store

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
  require('fs').writeFileSync(result.filePath, content, 'utf8');
  return true;
});

// ── IPC: Get network/drive locations ─────────────────────────────────────────
// Platform-aware detection feeding into one unified location format:
//   { label, path, icon: 'home'|'desktop'|'documents'|'downloads'|'pictures'|
//                         'music'|'videos'|'hdd'|'usb'|'network'|'disc'|'drive' }
ipcMain.handle('fs:getLocations', async () => {
  const locations = [];

  // Quick access — same on every platform
  locations.push({ label: 'Home', path: os.homedir(), icon: 'home' });
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
    const p = path.join(os.homedir(), name);
    try {
      fs.accessSync(p);
      locations.push({ label: name, path: p, icon: name.toLowerCase() });
    } catch {}
  }

  if (process.platform === 'win32') {
    locations.push(...getWindowsLocations());
  } else if (process.platform === 'darwin') {
    locations.push(...getMacLocations());
  } else {
    locations.push(...getLinuxLocations());
  }

  return locations;
});

function getWindowsLocations() {
  const locations = [];
  const { execSync } = require('child_process');

  // PowerShell Get-PSDrive replaces the deprecated wmic — reliable on Windows 11
  try {
    const psScript = `Get-PSDrive -PSProvider FileSystem | Select-Object Name,Description,Free,Used | ConvertTo-Json -Compress`;
    const out = execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const drives = Array.isArray(parsed) ? parsed : [parsed];
    for (const d of drives) {
      if (!d.Name) continue;
      const drivePath = `${d.Name}:\\`;
      const sizeLabel = d.Used != null && d.Free != null
        ? ` — ${formatBytes(d.Used + d.Free)}`
        : '';
      locations.push({
        label: `${d.Description || 'Local Disk'} (${d.Name}:)${sizeLabel}`,
        path: drivePath,
        icon: 'hdd',
      });
    }
  } catch {
    // Fallback if PowerShell is unavailable for any reason
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
  }

  // Network shares — Get-SmbMapping is the modern equivalent of `net use`
  try {
    const psScript = `Get-SmbMapping | Select-Object LocalPath,RemotePath | ConvertTo-Json -Compress`;
    const out = execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const mappings = Array.isArray(parsed) ? parsed : (parsed.LocalPath ? [parsed] : []);
    for (const m of mappings) {
      if (!m.LocalPath || !m.RemotePath) continue;
      locations.push({
        label: `${m.RemotePath} (${m.LocalPath})`,
        path: m.LocalPath + '\\',
        icon: 'network',
      });
    }
  } catch {
    // Fallback to `net use` parsing
    try {
      const netOut = execSync('net use', { encoding: 'utf8' });
      for (const line of netOut.split('\n')) {
        const match = line.match(/([A-Z]:)\s+(\\\\\S+)/);
        if (match) {
          locations.push({ label: `Network: ${match[2]} (${match[1]})`, path: match[1] + '\\', icon: 'network' });
        }
      }
    } catch {}
  }

  return locations;
}

function getMacLocations() {
  const locations = [];
  try {
    const vols = fs.readdirSync('/Volumes', { withFileTypes: true });
    for (const v of vols) {
      // Skip the boot volume — it's already covered by Home/Desktop/etc and
      // including it clutters the list with the entire OS filesystem
      if (v.name === 'Macintosh HD') continue;
      if (v.isDirectory() || v.isSymbolicLink()) {
        const volPath = `/Volumes/${v.name}`;
        // Network shares mounted via Finder also live under /Volumes; we can't always
        // distinguish them from local USB drives without deeper inspection, so default
        // to 'drive' and only mark as network if the name hints at it
        const looksNetwork = /^(smb|afp|nfs)[-_]/i.test(v.name) || v.name.includes('on ');
        locations.push({ label: v.name, path: volPath, icon: looksNetwork ? 'network' : 'drive' });
      }
    }
  } catch {}
  return locations;
}

function getLinuxLocations() {
  const locations = [];
  const isWSL = (() => {
    try { return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'); }
    catch { return false; }
  })();

  // WSL-specific: expose /mnt/c, /mnt/d etc. as friendly "Windows drive" shortcuts
  if (isWSL) {
    try {
      const entries = fs.readdirSync('/mnt', { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && /^[a-z]$/.test(e.name)) {
          locations.push({
            label: `Windows ${e.name.toUpperCase()}: drive (/mnt/${e.name})`,
            path: `/mnt/${e.name}`,
            icon: 'hdd',
          });
        }
      }
    } catch {}
  }

  // Parse /proc/mounts for real local and network filesystems
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smbfs', 'smb3']);
    const SKIP_FS = new Set(['proc', 'sysfs', 'devtmpfs', 'tmpfs', 'devpts', 'cgroup', 'cgroup2', 'overlay', 'squashfs', 'debugfs', 'tracefs', 'mqueue', 'securityfs', 'pstore', 'bpf', 'autofs', 'binfmt_misc']);

    for (const line of mounts.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [device, mountPoint, fsType] = parts;

      if (SKIP_FS.has(fsType)) continue;
      if (mountPoint === '/' || mountPoint.startsWith('/boot') || mountPoint.startsWith('/snap')) continue;
      if (isWSL && mountPoint.startsWith('/mnt/')) continue; // already added above with friendly labels

      if (NETWORK_FS.has(fsType)) {
        locations.push({ label: `Network: ${device} (${mountPoint})`, path: mountPoint, icon: 'network' });
      } else if (mountPoint.startsWith('/media/') || mountPoint.startsWith('/run/media/')) {
        locations.push({ label: `${path.basename(mountPoint)} (${mountPoint})`, path: mountPoint, icon: 'usb' });
      }
    }
  } catch {}

  // Direct check of /media and /run/media in case /proc/mounts parsing missed anything
  // (some distros mount removable media slightly differently)
  for (const base of ['/media', '/run/media']) {
    try {
      const topLevel = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of topLevel) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(base, entry.name);
        try {
          const subEntries = fs.readdirSync(sub, { withFileTypes: true });
          // /media/<user>/<device> on some distros — one extra level deep
          for (const s of subEntries) {
            if (s.isDirectory()) {
              const fullPath = path.join(sub, s.name);
              if (!locations.some(l => l.path === fullPath)) {
                locations.push({ label: `${s.name} (${fullPath})`, path: fullPath, icon: 'usb' });
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Network shares declared in /etc/fstab (may not be currently mounted, but
  // useful to surface as a target the user can still browse to)
  try {
    const fstab = fs.readFileSync('/etc/fstab', 'utf8');
    for (const line of fstab.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('//') || /\bnfs\b/.test(trimmed) || /\bcifs\b/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        if (parts[1] && parts[1].startsWith('/') && !locations.some(l => l.path === parts[1])) {
          locations.push({ label: `Network: ${parts[0]} → ${parts[1]}`, path: parts[1], icon: 'network' });
        }
      }
    }
  } catch {}

  return locations;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ── IPC: List subfolders of a directory (for the live folder-tree browser) ───
ipcMain.handle('fs:listDirectory', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const folders = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue; // hide dotfolders by default

      const fullPath = path.join(dirPath, entry.name);
      let subfolderCount = 0;
      try {
        subfolderCount = fs.readdirSync(fullPath, { withFileTypes: true }).filter(e => e.isDirectory()).length;
      } catch {
        // permission denied reading inside — still list the folder itself, just can't show a count
      }

      folders.push({ name: entry.name, path: fullPath, subfolderCount });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { success: true, path: dirPath, folders };
  } catch (e) {
    return { success: false, path: dirPath, error: e.code === 'EACCES' ? 'Permission denied' : e.message, folders: [] };
  }
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
        win?.webContents.send('scan:progress', { scanned: msg.scanned, phase: msg.phase, total: msg.total, currentPath: msg.currentPath ?? '' });
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
