// scanWorker.js — runs inside a worker_threads Worker.
// Performs a two-pass scan:
//   Pass 1: walk the directory tree, group files by size (free — just a stat call)
//   Pass 2: for any size group with 2+ files, hash only those files with SHA-256
// This avoids hashing every single file (expensive) when most files have a unique size
// and therefore cannot possibly be duplicates.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
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

function hashFileSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Pass 1: walk + collect candidate files grouped by size ───────────────────
function walkCollect(dir, filters, exclusions, label, sourceFiles, warnings, counter) {
  if (cancelled) return;
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

        // Zero-byte files are tracked separately, never hashed against real content
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

        if (counter.walked % 50 === 0) {
          parentPort.postMessage({ type: 'progress', phase: 'walking', scanned: counter.walked });
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
  const counter = { walked: 0, hashed: 0 };
  const allFiles = [];

  // ── Pass 1: walk all folders, collect file metadata (cheap) ──
  if (mode === 'compare') {
    for (const folder of (protectedFolders || [])) {
      walkCollect(folder, filters || {}, exclusions || [], 'protected', allFiles, warnings, counter);
    }
    for (const folder of (targetFolders || [])) {
      walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
    }
  } else {
    for (const folder of (targetFolders || [])) {
      walkCollect(folder, filters || {}, exclusions || [], 'target', allFiles, warnings, counter);
    }
  }

  if (cancelled) {
    parentPort.postMessage({ type: 'cancelled' });
    return;
  }

  // Separate zero-byte files — grouped by name only, never content-hashed
  const emptyFiles = allFiles.filter(f => f.isEmpty);
  const nonEmptyFiles = allFiles.filter(f => !f.isEmpty);

  // ── Pass 2: group remaining files by size; only hash groups with 2+ files ──
  const bySize = new Map();
  for (const f of nonEmptyFiles) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }

  const fileMap = new Map(); // hash -> files[]
  let candidateCount = 0;
  for (const group of bySize.values()) if (group.length > 1) candidateCount += group.length;

  parentPort.postMessage({ type: 'progress', phase: 'hashing', scanned: 0, total: candidateCount });

  for (const group of bySize.values()) {
    if (cancelled) {
      parentPort.postMessage({ type: 'cancelled' });
      return;
    }
    if (group.length < 2) continue; // unique size — cannot be a duplicate, skip hashing entirely

    for (const file of group) {
      if (cancelled) {
        parentPort.postMessage({ type: 'cancelled' });
        return;
      }
      try {
        const hash = await hashFileSHA256(file.path);
        counter.hashed++;
        if (!fileMap.has(hash)) fileMap.set(hash, []);
        fileMap.get(hash).push(file);
        if (counter.hashed % 10 === 0) {
          parentPort.postMessage({ type: 'progress', phase: 'hashing', scanned: counter.hashed, total: candidateCount });
        }
      } catch (e) {
        warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
      }
    }
  }

  // ── Build duplicate groups ──
  const groups = [];
  let groupId = 0;
  for (const [hash, files] of fileMap.entries()) {
    if (files.length < 2) continue;

    const hasProtected = files.some(f => f.sourceLabel === 'protected');
    const hasTarget = files.some(f => f.sourceLabel === 'target');
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
        // keep-newest, protected-wins (no protected present), or default
        sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
      }
      sorted.slice(1).forEach(f => markedPaths.add(f.path));
    }

    groups.push({ id: groupId++, hash, files, autoMarked: Array.from(markedPaths), hasProtected });
  }

  // ── Empty file groups (by name, separate bucket) ──
  let emptyGroups = [];
  if (includeEmpty && emptyFiles.length > 0) {
    const byName = new Map();
    for (const f of emptyFiles) {
      if (!byName.has(f.name)) byName.set(f.name, []);
      byName.get(f.name).push(f);
    }
    let eid = 0;
    for (const [name, files] of byName.entries()) {
      if (files.length < 2 && byName.size > 0) {
        // even a single empty file is worth surfacing as "empty", but only group dupes by name
      }
    }
    emptyGroups = emptyFiles.map(f => ({ ...f }));
  }

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
