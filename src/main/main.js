const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const isDev = process.env.NODE_ENV === 'development';

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

  // Home directory
  locations.push({ label: 'Home', path: os.homedir(), icon: 'home' });

  // Desktop / Documents / Downloads
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
    const p = path.join(os.homedir(), name);
    try {
      fs.accessSync(p);
      locations.push({ label: name, path: p, icon: name.toLowerCase() });
    } catch {}
  }

  if (process.platform === 'win32') {
    // Windows: drive letters
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

    // Windows network shares via net use
    try {
      const { execSync } = require('child_process');
      const netOut = execSync('net use', { encoding: 'utf8' });
      const lines = netOut.split('\n');
      for (const line of lines) {
        const match = line.match(/([A-Z]:)\s+(\\\\\S+)/);
        if (match) {
          locations.push({ label: `Network: ${match[2]} (${match[1]})`, path: match[1] + '\\', icon: 'network' });
        }
      }
    } catch {}

  } else {
    // Linux/macOS: /media and /mnt mounts
    for (const base of ['/media', '/mnt', '/run/media']) {
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const mp = path.join(base, e.name);
            try {
              // Check if mounted (has content)
              fs.readdirSync(mp);
              locations.push({ label: `${e.name} (${mp})`, path: mp, icon: 'usb' });
            } catch {}
          }
        }
      } catch {}
    }

    // macOS Volumes
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

    // Network shares from /etc/fstab
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const SUPPORTED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.heic', '.raw', '.bmp', '.webp',
  '.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a',
  '.mp4', '.mov', '.avi', '.mkv', '.wmv',
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.txt',
  '.zip', '.rar', '.7z', '.eml',
]);

const TYPE_MAP = {
  photos:   ['.jpg','.jpeg','.png','.gif','.heic','.raw','.bmp','.webp'],
  audio:    ['.mp3','.aac','.flac','.wav','.ogg','.m4a'],
  video:    ['.mp4','.mov','.avi','.mkv','.wmv'],
  docs:     ['.pdf','.docx','.xlsx','.pptx','.doc','.xls','.txt'],
  archives: ['.zip','.rar','.7z'],
};

function shouldInclude(filePath, filters) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  if (filters.types && filters.types.length > 0) {
    const allowed = filters.types.flatMap(t => TYPE_MAP[t] || []);
    if (!allowed.includes(ext)) return false;
  }
  if (filters.minSize && filters.minSize > 0) {
    try {
      if (fs.statSync(filePath).size < filters.minSize) return false;
    } catch { return false; }
  }
  return true;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function walkDir(dir, filters, fileMap, label, win, counter) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, filters, fileMap, label, win, counter);
    } else if (entry.isFile()) {
      if (!shouldInclude(fullPath, filters)) continue;
      try {
        const stat = fs.statSync(fullPath);
        const hash = await hashFile(fullPath);
        counter.n++;
        if (!fileMap.has(hash)) fileMap.set(hash, []);
        fileMap.get(hash).push({
          path: fullPath,
          name: entry.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          ext: path.extname(fullPath).toLowerCase(),
          sourceLabel: label, // 'protected' | 'target'
        });
        if (counter.n % 25 === 0) {
          win?.webContents.send('scan:progress', { scanned: counter.n });
        }
      } catch { /* skip unreadable */ }
    }
  }
}

// ── IPC: Scan ─────────────────────────────────────────────────────────────────
ipcMain.handle('scan:start', async (event, { mode, protectedFolders, targetFolders, filters, autoMarkRule }) => {
  const win = BrowserWindow.getFocusedWindow();
  const fileMap = new Map();
  const counter = { n: 0 };

  if (mode === 'compare') {
    for (const folder of (protectedFolders || [])) {
      await walkDir(folder, filters || {}, fileMap, 'protected', win, counter);
    }
    for (const folder of (targetFolders || [])) {
      await walkDir(folder, filters || {}, fileMap, 'target', win, counter);
    }
  } else {
    // simple mode — all folders are targets
    for (const folder of (targetFolders || [])) {
      await walkDir(folder, filters || {}, fileMap, 'target', win, counter);
    }
  }

  // Build groups
  const groups = [];
  let groupId = 0;
  for (const [hash, files] of fileMap.entries()) {
    if (files.length < 2) continue;

    const hasProtected = files.some(f => f.sourceLabel === 'protected');
    const hasTarget    = files.some(f => f.sourceLabel === 'target');

    // In compare mode only show groups that span both zones (or target-only dupes)
    if (mode === 'compare' && !hasTarget) continue;

    // Apply auto-mark rule
    let markedPaths = new Set();

    if (mode === 'compare' && hasProtected) {
      // Protected-wins: always mark target copies that duplicate a protected file
      files.filter(f => f.sourceLabel === 'target').forEach(f => markedPaths.add(f.path));
    } else {
      // Within target-only dupes, apply tiebreak rule
      let sorted;
      if (autoMarkRule === 'keep-newest' || autoMarkRule === 'protected-wins') {
        sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      } else if (autoMarkRule === 'keep-oldest') {
        sorted = [...files].sort((a, b) => new Date(a.modified) - new Date(b.modified));
      } else if (autoMarkRule === 'keep-largest') {
        sorted = [...files].sort((a, b) => b.size - a.size);
      } else {
        sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      }
      sorted.slice(1).forEach(f => markedPaths.add(f.path));
    }

    groups.push({
      id: groupId++,
      hash,
      files,
      autoMarked: Array.from(markedPaths),
      hasProtected,
    });
  }

  return { groups, totalScanned: counter.n, mode };
});

// ── IPC: Delete ───────────────────────────────────────────────────────────────
ipcMain.handle('files:delete', async (event, filePaths) => {
  const results = { deleted: [], failed: [] };
  for (const filePath of filePaths) {
    try {
      await shell.trashItem(filePath);
      results.deleted.push(filePath);
    } catch {
      try {
        fs.unlinkSync(filePath);
        results.deleted.push(filePath);
      } catch (e) {
        results.failed.push({ path: filePath, error: e.message });
      }
    }
  }
  return results;
});

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
