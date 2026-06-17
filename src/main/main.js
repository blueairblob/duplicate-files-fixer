const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../public/icon.png'),
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
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
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
  return result.canceled ? [] : result.filePaths;
});

// ── IPC: Scan for duplicates ──────────────────────────────────────────────────
ipcMain.handle('scan:start', async (event, { folders, filters }) => {
  const win = BrowserWindow.getFocusedWindow();
  const fileMap = new Map(); // hash -> [filePaths]
  let scanned = 0;

  const SUPPORTED_EXTS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.heic', '.raw', '.bmp', '.webp',
    '.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a',
    '.mp4', '.mov', '.avi', '.mkv', '.wmv',
    '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.txt',
    '.zip', '.rar', '.7z',
    '.eml',
  ]);

  function shouldInclude(filePath, filters) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return false;
    if (filters.types && filters.types.length > 0) {
      const typeMap = {
        photos: ['.jpg','.jpeg','.png','.gif','.heic','.raw','.bmp','.webp'],
        audio:  ['.mp3','.aac','.flac','.wav','.ogg','.m4a'],
        video:  ['.mp4','.mov','.avi','.mkv','.wmv'],
        docs:   ['.pdf','.docx','.xlsx','.pptx','.doc','.xls','.txt'],
        archives:['.zip','.rar','.7z'],
      };
      const allowed = filters.types.flatMap(t => typeMap[t] || []);
      if (!allowed.includes(ext)) return false;
    }
    if (filters.minSize && filters.minSize > 0) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < filters.minSize) return false;
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

  async function walkDir(dir, filters) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, filters);
      } else if (entry.isFile()) {
        if (!shouldInclude(fullPath, filters)) continue;
        try {
          const stat = fs.statSync(fullPath);
          const hash = await hashFile(fullPath);
          scanned++;
          if (!fileMap.has(hash)) fileMap.set(hash, []);
          fileMap.get(hash).push({
            path: fullPath,
            name: entry.name,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            ext: path.extname(fullPath).toLowerCase(),
          });
          if (scanned % 50 === 0) {
            win?.webContents.send('scan:progress', { scanned });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  for (const folder of folders) {
    await walkDir(folder, filters || {});
  }

  // Build duplicate groups (only groups with >1 file)
  const groups = [];
  let groupId = 0;
  for (const [hash, files] of fileMap.entries()) {
    if (files.length > 1) {
      groups.push({ id: groupId++, hash, files });
    }
  }

  return { groups, totalScanned: scanned };
});

// ── IPC: Delete files ─────────────────────────────────────────────────────────
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

// ── IPC: Get file stats ────────────────────────────────────────────────────────
ipcMain.handle('files:stat', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, modified: stat.mtime.toISOString(), exists: true };
  } catch {
    return { exists: false };
  }
});

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
