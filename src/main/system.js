// OS lookups used by scan-root checks and the delete path. No Electron imports.

const fs = require('fs');
const { execFile } = require('child_process');
const { analyseRoots } = require('./roots');

function runCapture(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Mapped network drives (Windows): [{ local: 'Z:', remote: '\\\\nas\\share' }].
// Used to spot one folder reached through two paths, and to keep network
// files away from the Recycle Bin (which doesn't cover them).
let mappingsCache = { at: 0, list: [] };
async function getNetworkMappings() {
  if (process.platform !== 'win32') return [];
  if (Date.now() - mappingsCache.at < 30000) return mappingsCache.list;
  let list = [];
  const ps = await runCapture('powershell', ['-NoProfile', '-Command', 'Get-SmbMapping | Select-Object LocalPath,RemotePath | ConvertTo-Json -Compress']);
  try {
    const parsed = ps ? JSON.parse(ps) : null;
    const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    list = arr.filter(m => m.LocalPath && m.RemotePath).map(m => ({ local: m.LocalPath, remote: m.RemotePath }));
  } catch { list = []; }
  if (list.length === 0) {
    const out = await runCapture('net', ['use']);
    for (const line of (out || '').split('\n')) {
      const m = line.match(/([A-Z]:)\s+(\\\\\S+)/);
      if (m) list.push({ local: m[1], remote: m[2] });
    }
  }
  mappingsCache = { at: Date.now(), list };
  return list;
}

// Resolve symlinks/junctions (and, on Windows, often mapped drives) per root.
async function resolveRealpaths(paths) {
  const out = {};
  for (const p of paths) {
    try { out[p] = await fs.promises.realpath.native(p); } catch { /* keep as given */ }
  }
  return out;
}

async function checkRoots(opts) {
  if (!opts || opts.mode === 'simple') return { blocked: [], excludeFromTarget: [] };
  const protectedRoots = opts.protectedFolders || [];
  const targetRoots = opts.targetFolders || [];
  const [mappings, realpaths] = await Promise.all([
    getNetworkMappings(),
    resolveRealpaths([...protectedRoots, ...targetRoots]),
  ]);
  return analyseRoots({ protectedRoots, targetRoots, platform: process.platform, mappings, realpaths });
}

module.exports = { runCapture, getNetworkMappings, resolveRealpaths, checkRoots };
