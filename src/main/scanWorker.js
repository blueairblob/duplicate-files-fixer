// scanWorker.js — runs inside a worker_threads Worker.
//
// Three-pass scan strategy:
//   Pass 1: walk the directory tree, collect file metadata (stat only — cheap)
//   Pass 2: for size-collision groups, hash first+last 64 KB only (boundary hash)
//           This eliminates near-identical-but-not-identical files cheaply.
//   Pass 3: full SHA-256 only for files whose boundary hash also collides (rare).
//           True duplicates always share the same full hash.
//
// I/O model: every step uses ASYNC I/O driven through a bounded concurrency pool.
// On a NAS/network drive each stat/read is a round-trip, so throughput is limited
// by latency, not CPU — the win is keeping many requests in flight from this one
// worker, NOT spawning more OS threads (which would just contend for one pipe).
// Async I/O also keeps the worker's message loop live, so progress keeps flowing
// and a Cancel is processed immediately instead of after a blocking syscall.

const { parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { isExcluded } = require('./exclusions');

// How many I/O operations to keep in flight at once. Tunable via scan options;
// 16 is a good default for a NAS. Local SSDs can go higher, but the returns
// flatten quickly and very high values can starve the event loop.
const CONCURRENCY = Math.max(1, Number(workerData.concurrency) || 16);

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
const BOUNDARY_BYTES = 64 * 1024;

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') cancelled = true;
});

// ── Progress emission ────────────────────────────────────────────────────────
// Time-based throttle: emit at most once every ~100ms (plus forced emits at
// phase boundaries). This keeps the UI ticker smooth regardless of whether we
// are ripping through thousands of tiny files or grinding one huge one, and
// stops a fast concurrent pool from flooding the IPC channel.
let lastProgressAt = 0;
function emitProgress(payload, force = false) {
  const now = Date.now();
  if (force || now - lastProgressAt >= 100) {
    lastProgressAt = now;
    parentPort.postMessage({ type: 'progress', ...payload });
  }
}

// ── Bounded concurrency pool ─────────────────────────────────────────────────
// Runs `task` over `items` with at most `concurrency` in flight. Bails out early
// when cancelled. Single-threaded async — no locks needed for shared Maps.
async function runPool(items, concurrency, task) {
  let next = 0;
  const width = Math.min(concurrency, items.length);
  const runners = [];
  for (let w = 0; w < width; w++) {
    runners.push((async () => {
      while (next < items.length && !cancelled) {
        const i = next++;
        await task(items[i], i);
      }
    })());
  }
  await Promise.all(runners);
}

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
// Fully async (fsp) so a slow read never blocks the worker's message loop.
// Returns a hex string prefixed with "B:" so it can never collide with full hashes.
async function hashFileBoundary(filePath, fileSize) {
  const hash = crypto.createHash('sha256');

  if (fileSize <= BOUNDARY_BYTES * 2) {
    // Small file — full read is fine and avoids two seeks.
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data',  d  => hash.update(d));
      stream.on('end',   resolve);
      stream.on('error', reject);
    });
    return 'B:' + hash.digest('hex');
  }

  // Large file — read head then tail via an async file handle.
  const fd = await fsp.open(filePath, 'r');
  try {
    const head = Buffer.alloc(BOUNDARY_BYTES);
    const tail = Buffer.alloc(BOUNDARY_BYTES);
    const { bytesRead: nHead } = await fd.read(head, 0, BOUNDARY_BYTES, 0);
    const { bytesRead: nTail } = await fd.read(tail, 0, BOUNDARY_BYTES, fileSize - BOUNDARY_BYTES);
    hash.update(head.subarray(0, nHead));
    hash.update(tail.subarray(0, nTail));
    return 'B:' + hash.digest('hex');
  } finally {
    await fd.close();
  }
}

// ── Pass 1: walk + collect candidate files grouped by size ───────────────────
// Async recursion: readdir per directory, then stat this directory's files
// through the concurrency pool (the per-file round-trip is the NAS bottleneck).
async function walkCollect(dir, filters, exclusions, label, sourceFiles, warnings, counter) {
  if (cancelled) return;

  emitProgress({ phase: 'walking', scanned: counter.walked, currentPath: dir });

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    warnings.push({ path: dir, reason: e.code === 'EACCES' ? 'Permission denied' : e.message });
    return;
  }

  const subdirs = [];
  const files   = [];
  for (const entry of entries) {
    if (cancelled) return;
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath, exclusions)) continue;
    if (entry.isDirectory())  subdirs.push(fullPath);
    else if (entry.isFile())  files.push({ fullPath, name: entry.name });
  }

  // Stat this directory's files concurrently.
  await runPool(files, CONCURRENCY, async ({ fullPath, name }) => {
    if (cancelled) return;
    if (!shouldIncludeExt(fullPath, filters)) return;
    try {
      const stat = await fsp.stat(fullPath);
      if (filters.minSize && filters.minSize > 0 && stat.size < filters.minSize) return;

      counter.walked++;
      sourceFiles.push({
        path: fullPath,
        name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        ext: path.extname(fullPath).toLowerCase(),
        sourceLabel: label,
        isEmpty: stat.size === 0,
      });
      emitProgress({ phase: 'walking', scanned: counter.walked, currentPath: fullPath });
    } catch (e) {
      warnings.push({ path: fullPath, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  // Then descend into subdirectories.
  for (const sub of subdirs) {
    if (cancelled) return;
    await walkCollect(sub, filters, exclusions, label, sourceFiles, warnings, counter);
  }
}

async function run() {
  const { mode, protectedFolders, targetFolders, filters, autoMarkRule, exclusions, includeEmpty } = workerData;

  const warnings = [];
  const counter  = { walked: 0, hashed: 0 };
  const allFiles = [];

  // Seed the ticker immediately so the UI shows life before the first batch.
  const firstFolder = targetFolders[0] || protectedFolders[0] || '';
  emitProgress({ phase: 'walking', scanned: 0, currentPath: firstFolder }, true);

  // ── Pass 1: walk all folders, collect file metadata (cheap) ──────────────
  if (mode === 'compare' || mode === 'verify') {
    for (const folder of (protectedFolders || [])) {
      if (cancelled) break;
      await walkCollect(folder, filters || {}, exclusions || [], 'protected', allFiles, warnings, counter);
    }
    for (const folder of (targetFolders || [])) {
      if (cancelled) break;
      await walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
    }
  } else {
    for (const folder of (targetFolders || [])) {
      if (cancelled) break;
      await walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
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

  const candidateFiles = [];
  for (const group of bySize.values()) {
    if (group.length >= 2) candidateFiles.push(...group);
  }

  const candidateCount = candidateFiles.length;
  emitProgress({ phase: 'hashing', scanned: 0, total: candidateCount, currentPath: firstFolder }, true);

  // boundary hash → file[]
  const byBoundaryHash = new Map();

  await runPool(candidateFiles, CONCURRENCY, async (file) => {
    if (cancelled) return;
    try {
      const bHash = await hashFileBoundary(file.path, file.size);
      if (!byBoundaryHash.has(bHash)) byBoundaryHash.set(bHash, []);
      byBoundaryHash.get(bHash).push(file);

      counter.hashed++;
      emitProgress({ phase: 'hashing', scanned: counter.hashed, total: candidateCount, currentPath: file.path });
    } catch (e) {
      warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

  // ── Pass 3: full SHA-256 only for boundary-hash collisions ───────────────
  const fullHashCandidates = [];
  for (const group of byBoundaryHash.values()) {
    if (group.length >= 2) fullHashCandidates.push(...group);
  }

  const fullHashTotal = fullHashCandidates.length;
  let fullHashed = 0;

  emitProgress({ phase: 'verifying', scanned: 0, total: fullHashTotal, currentPath: firstFolder }, true);

  const fileMap = new Map(); // fullHash → file[]

  await runPool(fullHashCandidates, CONCURRENCY, async (file) => {
    if (cancelled) return;
    try {
      const hash = await hashFileFull(file.path);
      fullHashed++;
      if (!fileMap.has(hash)) fileMap.set(hash, []);
      fileMap.get(hash).push({ ...file });
      emitProgress({ phase: 'verifying', scanned: fullHashed, total: fullHashTotal, currentPath: file.path });
    } catch (e) {
      warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

  // ── Build duplicate groups (compare / simple modes) ──────────────────────
  const groups = [];
  let groupId = 0;

  if (mode !== 'verify') {
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
  }

  // ── Build verify report ───────────────────────────────────────────────────
  // Three buckets: matched (in both), nasOnly (protected only — backup gap),
  // desktopOnly (target only — safe but not in NAS).
  let verifyReport = null;
  if (mode === 'verify') {
    const matched     = []; // files in both
    const nasOnly     = []; // protected only — missing from desktop
    const desktopOnly = []; // target only — extra on desktop

    for (const [hash, files] of fileMap.entries()) {
      const hasProtected = files.some(f => f.sourceLabel === 'protected');
      const hasTarget    = files.some(f => f.sourceLabel === 'target');
      if (hasProtected && hasTarget) {
        matched.push({
          hash,
          nasFile:     files.find(f => f.sourceLabel === 'protected'),
          desktopFile: files.find(f => f.sourceLabel === 'target'),
          allFiles: files,
        });
      } else if (hasProtected && !hasTarget) {
        files.filter(f => f.sourceLabel === 'protected').forEach(f => nasOnly.push(f));
      } else if (!hasProtected && hasTarget) {
        files.filter(f => f.sourceLabel === 'target').forEach(f => desktopOnly.push(f));
      }
    }

    // Size-singleton files never entered fileMap — add them to the right bucket.
    // Build the set of hashed paths once (O(n)) instead of rescanning fileMap for
    // every file (O(n*m)), which was pathological on large trees / NAS scans.
    const hashedPaths = new Set();
    for (const files of fileMap.values()) {
      for (const mf of files) hashedPaths.add(mf.path);
    }
    for (const f of nonEmptyFiles) {
      if (!hashedPaths.has(f.path)) {
        if (f.sourceLabel === 'protected') nasOnly.push(f);
        else desktopOnly.push(f);
      }
    }

    nasOnly.sort((a, b) => a.path.localeCompare(b.path));
    desktopOnly.sort((a, b) => a.path.localeCompare(b.path));

    const sum = arr => arr.reduce((acc, f) => acc + (f.size || f.nasFile?.size || 0), 0);

    verifyReport = {
      matched,
      nasOnly,
      desktopOnly,
      summary: {
        matchedCount:     matched.length,
        nasOnlyCount:     nasOnly.length,
        desktopOnlyCount: desktopOnly.length,
        matchedSize:      sum(matched.map(m => m.nasFile)),
        nasOnlySize:      sum(nasOnly),
        desktopOnlySize:  sum(desktopOnly),
        totalNas:         allFiles.filter(f => f.sourceLabel === 'protected').length,
        totalDesktop:     allFiles.filter(f => f.sourceLabel === 'target').length,
      },
    };
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
      verifyReport,
    },
  });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
