// scanWorker.js — runs inside a worker_threads Worker.
//
// Three-pass scan strategy:
//   Pass 1: walk the directory tree, collect file metadata (stat only — cheap)
//   Pass 2: for size-collision groups, hash first+last 64 KB only (boundary hash)
//           This eliminates near-identical-but-not-identical files cheaply.
//   Pass 3: full SHA-256 only for files whose boundary hash also collides (rare).
//           True duplicates always share the same full hash.
//
// This is identical to the strategy used by fdupes / rmlint. On a NAS where
// reading a full 10 MB file costs ~100 ms, a 64 KB boundary read costs ~1 ms.
// For a library of 10,000 photo candidates the saving is typically 99%+ of I/O.

const { parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isExcluded } = require('./exclusions');

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

// How many bytes to read from start + end of file for the cheap boundary hash.
// 64 KB each = 128 KB total max read vs potentially GBs for a full hash.
const BOUNDARY_BYTES = 64 * 1024;

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') cancelled = true;
});

function shouldIncludeExt(filePath, filters) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  if (filters.types && filters.types.length > 0) {
    const allowed = filters.types.flatMap(t => TYPE_MAP[t] || []);
    if (!allowed.includes(ext)) return false;
  }
  return true;
}

// ── Hashing helpers ──────────────────────────────────────────────────────────

// Full SHA-256 — only called when boundary hashes collide (rare).
function hashFileFull(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end',  ()  => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Boundary hash: read first BOUNDARY_BYTES + last BOUNDARY_BYTES of the file.
// For files <= 2×BOUNDARY_BYTES we read the whole thing (still cheap).
// Returns a hex string prefixed with "B:" so it can never collide with full hashes.
async function hashFileBoundary(filePath, fileSize) {
  return new Promise((resolve, reject) => {
    if (fileSize <= BOUNDARY_BYTES * 2) {
      // Small file — full read is fine and avoids two seeks.
      const hash   = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data',  d  => hash.update(d));
      stream.on('end',   ()  => resolve('B:' + hash.digest('hex')));
      stream.on('error', reject);
      return;
    }

    // Large file — read head then tail.
    const hash = crypto.createHash('sha256');
    const fd   = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(BOUNDARY_BYTES);
      const tail = Buffer.alloc(BOUNDARY_BYTES);
      const nHead = fs.readSync(fd, head, 0, BOUNDARY_BYTES, 0);
      const nTail = fs.readSync(fd, tail, 0, BOUNDARY_BYTES, fileSize - BOUNDARY_BYTES);
      hash.update(head.subarray(0, nHead));
      hash.update(tail.subarray(0, nTail));
      resolve('B:' + hash.digest('hex'));
    } catch (e) {
      reject(e);
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  });
}

// ── Pass 1: walk + collect candidate files grouped by size ───────────────────
function walkCollect(dir, filters, exclusions, label, sourceFiles, warnings, counter) {
  if (cancelled) return;

  // Emit an immediate progress ping when entering each new directory so the UI
  // shows activity even before the first batch of files is collected.
  parentPort.postMessage({
    type: 'progress',
    phase: 'walking',
    scanned: counter.walked,
    currentPath: dir,
  });

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    warnings.push({ path: dir, reason: e.code === 'EACCES' ? 'Permission denied' : e.message });
    return;
  }

  for (const entry of entries) {
    if (cancelled) return;
    const fullPath = path.join(dir, entry.name);

    if (isExcluded(fullPath, exclusions)) continue;

    if (entry.isDirectory()) {
      walkCollect(fullPath, filters, exclusions, label, sourceFiles, warnings, counter);
    } else if (entry.isFile()) {
      if (!shouldIncludeExt(fullPath, filters)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (filters.minSize && filters.minSize > 0 && stat.size < filters.minSize) continue;

        const isEmpty = stat.size === 0;

        counter.walked++;
        sourceFiles.push({
          path: fullPath,
          name: entry.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          ext: path.extname(fullPath).toLowerCase(),
          sourceLabel: label,
          isEmpty,
        });

        // Emit every 25 files (finer-grained than before — important on slow NAS).
        if (counter.walked % 25 === 0) {
          parentPort.postMessage({
            type: 'progress',
            phase: 'walking',
            scanned: counter.walked,
            currentPath: fullPath,
          });
        }
      } catch (e) {
        warnings.push({ path: fullPath, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
      }
    }
  }
}

async function run() {
  const { mode, protectedFolders, targetFolders, filters, autoMarkRule, exclusions, includeEmpty } = workerData;

  const warnings = [];
  const counter  = { walked: 0, hashed: 0 };
  const allFiles = [];

  // Send an immediate heartbeat so the UI knows the worker started.
  parentPort.postMessage({ type: 'progress', phase: 'walking', scanned: 0, currentPath: '' });

  // ── Pass 1: walk all folders, collect file metadata (cheap) ──────────────
  if (mode === 'compare') {
    for (const folder of (protectedFolders || [])) {
      if (cancelled) break;
      walkCollect(folder, filters || {}, exclusions || [], 'protected', allFiles, warnings, counter);
    }
    for (const folder of (targetFolders || [])) {
      if (cancelled) break;
      walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
    }
  } else {
    for (const folder of (targetFolders || [])) {
      if (cancelled) break;
      walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
    }
  }

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

  // Separate zero-byte files — grouped by name only, never content-hashed.
  const emptyFiles    = allFiles.filter(f =>  f.isEmpty);
  const nonEmptyFiles = allFiles.filter(f => !f.isEmpty);

  // ── Pass 2: group by size, boundary-hash only collisions ─────────────────
  const bySize = new Map();
  for (const f of nonEmptyFiles) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }

  const sizeGroups = [];
  for (const group of bySize.values()) {
    if (group.length >= 2) sizeGroups.push(group);
  }

  const candidateCount = sizeGroups.reduce((acc, g) => acc + g.length, 0);
  parentPort.postMessage({ type: 'progress', phase: 'hashing', scanned: 0, total: candidateCount, currentPath: '' });

  // boundary hash → file[]
  const byBoundaryHash = new Map();

  for (const group of sizeGroups) {
    if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

    for (const file of group) {
      if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }
      try {
        const bHash = await hashFileBoundary(file.path, file.size);
        file._boundaryHash = bHash;
        if (!byBoundaryHash.has(bHash)) byBoundaryHash.set(bHash, []);
        byBoundaryHash.get(bHash).push(file);

        counter.hashed++;
        if (counter.hashed % 10 === 0) {
          parentPort.postMessage({
            type: 'progress', phase: 'hashing',
            scanned: counter.hashed, total: candidateCount,
            currentPath: file.path,
          });
        }
      } catch (e) {
        warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
      }
    }
  }

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

  // ── Pass 3: full SHA-256 only for boundary-hash collisions ───────────────
  const fullHashCandidates = [];
  for (const group of byBoundaryHash.values()) {
    if (group.length >= 2) fullHashCandidates.push(...group);
  }

  const fullHashTotal = fullHashCandidates.length;
  let fullHashed = 0;

  parentPort.postMessage({
    type: 'progress', phase: 'verifying',
    scanned: 0, total: fullHashTotal, currentPath: '',
  });

  const fileMap = new Map(); // fullHash → file[]

  for (const file of fullHashCandidates) {
    if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }
    try {
      const hash = await hashFileFull(file.path);
      fullHashed++;
      if (!fileMap.has(hash)) fileMap.set(hash, []);
      fileMap.get(hash).push({ ...file, _boundaryHash: undefined });

      if (fullHashed % 5 === 0) {
        parentPort.postMessage({
          type: 'progress', phase: 'verifying',
          scanned: fullHashed, total: fullHashTotal,
          currentPath: file.path,
        });
      }
    } catch (e) {
      warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  }

  // ── Build duplicate groups ────────────────────────────────────────────────
  const groups = [];
  let groupId = 0;
  for (const [hash, files] of fileMap.entries()) {
    if (files.length < 2) continue;

    const hasProtected = files.some(f => f.sourceLabel === 'protected');
    const hasTarget    = files.some(f => f.sourceLabel === 'target');
    if (mode === 'compare' && !hasTarget) continue;

    const markedPaths = new Set();
    if (mode === 'compare' && hasProtected) {
      files.filter(f => f.sourceLabel === 'target').forEach(f => markedPaths.add(f.path));
    } else {
      let sorted;
      if (autoMarkRule === 'keep-oldest') {
        sorted = [...files].sort((a, b) => new Date(a.modified) - new Date(b.modified));
      } else if (autoMarkRule === 'keep-largest') {
        sorted = [...files].sort((a, b) => b.size - a.size);
      } else {
        sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      }
      sorted.slice(1).forEach(f => markedPaths.add(f.path));
    }

    groups.push({ id: groupId++, hash, files, autoMarked: Array.from(markedPaths), hasProtected });
  }

  // ── Empty file groups ─────────────────────────────────────────────────────
  const emptyGroups = (includeEmpty && emptyFiles.length > 0)
    ? emptyFiles.map(f => ({ ...f }))
    : [];

  parentPort.postMessage({
    type: 'done',
    result: {
      groups,
      emptyFiles: includeEmpty ? emptyGroups : [],
      totalScanned: counter.walked,
      totalHashed: counter.hashed,
      warnings,
      mode,
    },
  });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
