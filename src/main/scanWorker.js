// scanWorker.js — runs inside a worker_threads Worker.
//
// Three-pass scan strategy:
//   Pass 1: walk the directory tree, collect file metadata (stat only — cheap)
//   Pass 2: for size-collision groups, hash the first 64 KB only (boundary hash)
//           — head only on purpose, see hashFileBoundary.
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
const { normaliseRoot } = require('./roots');
const { shouldIncludeFile, sizeCandidates, buildGroups, buildCensus, censusProblems, buildVerifyReport } = require('./scanCore');

// Protected folders that sit inside a target root (normalised, see roots.js).
// The target walk skips them so protected files are never seen as target files.
const PLATFORM = workerData.platform || process.platform;
const ROOT_EXCLUDES = new Set(workerData.rootExcludes || []);

// File identity (device + inode). One physical file reached through two paths
// (overlapping roots, a mapped drive and its UNC path, a junction) must be
// counted once — otherwise it looks like a duplicate of itself and "deleting
// the copy" deletes the only copy. First sighting wins; protected roots are
// walked first, so the protected label is kept.
const seenIds = new Set();
let aliasSkipped = 0;

// How many I/O operations to keep in flight at once. Tunable via scan options;
// 16 is a good default for a NAS. Local SSDs can go higher, but the returns
// flatten quickly and very high values can starve the event loop.
const CONCURRENCY = Math.max(1, Number(workerData.concurrency) || 32);

// Match confidence: how much evidence is required to call two files duplicates.
//   quick    — size + filename only (no content reads)
//   standard — size + 64KB head hash (boundary phase only)          [default]
//   thorough — boundary pre-filter, then full byte-for-byte SHA-256
// Standard/Quick deletions are protected by verify-on-delete in the main
// process, which full-hash-compares each file against its kept counterpart
// at deletion time.
const CONFIDENCE = ['quick', 'standard', 'thorough'].includes(workerData.confidence)
  ? workerData.confidence : 'standard';

// ── Signature cache ──────────────────────────────────────────────────────────
// Persists (size, mtime) → boundary/full hashes per path, so unchanged files
// are never re-read. This makes repeat scans of slow network shares run at
// walk speed: the NAS's ~15 ops/s ceiling only ever applies to files that are
// new or modified since the last scan.
// Validity token is exact size + mtime ISO string; any mismatch → recompute.
const CACHE_PATH = workerData.cachePath || null;
let sigCache = { version: 1, entries: {} };
if (CACHE_PATH) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (loaded && loaded.version === 1 && loaded.entries) sigCache = loaded;
  } catch { /* first run or unreadable — start fresh */ }
}
const cacheStats = { bhHits: 0, bhMisses: 0, fhHits: 0, fhMisses: 0 };

function cacheGet(file, kind) {
  const e = sigCache.entries[file.path];
  if (e && e.size === file.size && e.m === file.modified && e[kind]) return e[kind];
  return null;
}
function cachePut(file, kind, value) {
  let e = sigCache.entries[file.path];
  if (!e || e.size !== file.size || e.m !== file.modified) {
    e = { size: file.size, m: file.modified };
    sigCache.entries[file.path] = e;
  }
  e[kind] = value;
}
function cacheSave() {
  if (!CACHE_PATH) return;
  try {
    const paths = Object.keys(sigCache.entries);
    const MAX_ENTRIES = 500000;
    if (paths.length > MAX_ENTRIES) {
      for (const p of paths.slice(0, paths.length - MAX_ENTRIES)) delete sigCache.entries[p];
    }
    const tmp = CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sigCache));
    fs.renameSync(tmp, CACHE_PATH);
    if (PERF_VERBOSE || cacheStats.bhHits || cacheStats.bhMisses || cacheStats.fhHits || cacheStats.fhMisses) {
      console.log(`[scan] cache: ${Object.keys(sigCache.entries).length.toLocaleString()} entries · boundary ${cacheStats.bhHits}/${cacheStats.bhHits + cacheStats.bhMisses} cached · full ${cacheStats.fhHits}/${cacheStats.fhHits + cacheStats.fhMisses} cached`);
    }
  } catch (e) {
    console.error('[scan] cache: save failed —', e.message);
  }
}

// How many bytes to read from the start of a file for the cheap boundary hash.
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
// ── Perf instrumentation ─────────────────────────────────────────────────────
// Prints [scan-perf] lines to the terminal. One scan gives a full timing
// picture: effective pool width, thread pool size, per-phase rate and avg
// per-op latency — enough to pinpoint any serialization without guessing.
// Verbose tracing is opt-in: `set DFF_PERF=1` (PowerShell: $env:DFF_PERF=1)
// before `npm run dev`. It found the NAS boundary-hash bottleneck; leaving it
// on by default buries real errors under thousands of lines per scan.
const PERF_VERBOSE = process.env.DFF_PERF === '1';

const perf = { phase: null, t0: 0, ops: 0, phases: [] };
function perfPhase(name, plannedOps) {
  if (perf.phase) perfPhaseEnd();
  perf.phase = name; perf.t0 = Date.now(); perf.ops = 0;
  if (PERF_VERBOSE) {
    console.log(`[scan-perf] ${name}: start  pool=${CONCURRENCY} UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || '(unset=4)'} planned=${plannedOps ?? '?'}`);
  }
}
function perfTick() {
  perf.ops++;
  if (PERF_VERBOSE && perf.ops % 500 === 0) {
    const secs = (Date.now() - perf.t0) / 1000;
    console.log(`[scan-perf] ${perf.phase}: ${perf.ops} ops in ${secs.toFixed(1)}s  (${(perf.ops/secs).toFixed(1)}/s, avg ${(secs*1000/perf.ops).toFixed(1)}ms/op incl. queueing)`);
  }
}
function perfPhaseEnd() {
  if (!perf.phase) return;
  const secs = Math.max(0.001, (Date.now() - perf.t0) / 1000);
  perf.phases.push({ name: perf.phase, ops: perf.ops, secs });
  if (PERF_VERBOSE) {
    console.log(`[scan-perf] ${perf.phase}: DONE  ${perf.ops} ops in ${secs.toFixed(1)}s  (${(perf.ops/secs).toFixed(1)}/s)`);
  }
  perf.phase = null;
}
// One line per scan by default — enough to spot a regression, quiet enough
// that a warning stands out.
function perfSummary() {
  if (perf.phase) perfPhaseEnd();
  const parts = perf.phases
    .filter(p => p.ops > 0)
    .map(p => `${p.name} ${p.ops.toLocaleString()} in ${p.secs.toFixed(1)}s (${Math.round(p.ops / p.secs).toLocaleString()}/s)`);
  if (parts.length) console.log(`[scan] ${parts.join(' · ')}`);
}

// Per-root concurrency limiter: a spinning-disk NAS served 31 concurrent
// random reads with multi-second FIFO latencies; shallow per-root queues keep
// latency sane while the global pool overlaps roots freely.
const ROOT_LIMIT = 8;        // small single-read ops (boundary hashing)
const STREAM_ROOT_LIMIT = 3; // full-file streams: fewer at once = less seek thrash
const rootGates = new Map();
function rootOf(p) {
  const drive = /^[A-Za-z]:/.exec(p);
  if (drive) return drive[0].toUpperCase();
  const unc = /^\\\\[^\\]+\\[^\\]+/.exec(p);
  return unc ? unc[0].toLowerCase() : '?';
}
async function withRootLimit(p, fn, limit = ROOT_LIMIT) {
  const root = rootOf(p);
  let gate = rootGates.get(root);
  if (!gate) { gate = { active: 0, waiters: [] }; rootGates.set(root, gate); }
  while (gate.active >= limit) {
    await new Promise(resolve => gate.waiters.push(resolve));
  }
  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    const next = gate.waiters.shift();
    if (next) next();
  }
}

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

// ── Hashing helpers ──────────────────────────────────────────────────────────

// Full SHA-256 — only called when boundary hashes collide (rare).
function hashFileFull(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    // 1MB chunks: SMB round-trips per file drop ~15x vs the 64KB default,
    // which dominates full-read throughput on high-latency shares.
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', d => hash.update(d));
    stream.on('end',  ()  => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Boundary hash: read first BOUNDARY_BYTES + last BOUNDARY_BYTES of the file.
// For files <= 2×BOUNDARY_BYTES we read the whole thing (still cheap).
// Fully async (fsp) so a slow read never blocks the worker's message loop.
// Returns a hex string prefixed with "B:" so it can never collide with full hashes.
let bhOps = 0;        // completed boundary ops
let bhInFlight = 0;   // concurrent boundary ops gauge

function bhLog(filePath, fileSize, stages, totalMs) {
  if (!PERF_VERBOSE) return;
  const side = filePath.length >= 2 && filePath[1] === ':' ? filePath.slice(0, 2) : '?';
  const parts = Object.entries(stages).map(([k, v]) => `${k}=${v.toFixed(0)}ms`).join(' ');
  console.log(`[bh-perf] #${bhOps} ${side} inflight=${bhInFlight} total=${totalMs.toFixed(0)}ms ${parts} size=${(fileSize/1024).toFixed(0)}KB ${path.basename(filePath)}`);
}

async function hashFileBoundary(filePath, fileSize) {
  const hash = crypto.createHash('sha256');
  const stages = {};
  const t0 = performance.now();
  let mark = t0;
  const lap = (name) => { const now = performance.now(); stages[name] = now - mark; mark = now; };
  bhInFlight++;

  try {
    if (fileSize <= BOUNDARY_BYTES * 2) {
      // Small file — full read is fine and avoids a second dispatch.
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        stream.on('data',  d  => hash.update(d));
        stream.on('end',   resolve);
        stream.on('error', reject);
      });
      lap('stream');
      return 'H:' + hash.digest('hex');
    }

    // Large file — HEAD-ONLY on purpose. A tail read is a far-offset random
    // seek that devastates spinning-disk NAS throughput (measured ~2s/file at
    // a 32-deep queue). (size, head-64KB) is a safe pre-filter: collisions are
    // resolved by the full-hash verify phase; differing files are never
    // falsely excluded.
    const fd = await fsp.open(filePath, 'r');
    lap('open');
    try {
      const head = Buffer.alloc(BOUNDARY_BYTES);
      const { bytesRead: nHead } = await fd.read(head, 0, BOUNDARY_BYTES, 0);
      lap('readHead');
      hash.update(head.subarray(0, nHead));
      return 'H:' + hash.digest('hex');
    } finally {
      await fd.close();
      lap('close');
    }
  } finally {
    bhInFlight--;
    bhOps++;
    const totalMs = performance.now() - t0;
    if (bhOps <= 25 || totalMs > 250) bhLog(filePath, fileSize, stages, totalMs);
  }
}

// ── Pass 1: walk + collect candidate files grouped by size ───────────────────
// Async recursion: readdir per directory, then stat this directory's files
// through the concurrency pool (the per-file round-trip is the NAS bottleneck).
async function walkCollect(dir, filters, exclusions, label, sourceFiles, warnings, counter, root) {
  if (root === undefined) root = dir;
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
    if (entry.isDirectory() && label === 'target' && ROOT_EXCLUDES.has(normaliseRoot(fullPath, PLATFORM))) continue;
    if (entry.isDirectory())  subdirs.push(fullPath);
    else if (entry.isFile())  files.push({ fullPath, name: entry.name });
  }

  // Stat this directory's files concurrently.
  await runPool(files, CONCURRENCY, async ({ fullPath, name }) => {
    if (cancelled) return;
    if (!shouldIncludeFile(fullPath, filters)) return;
    try {
      // bigint: NTFS file IDs can exceed 2^53, so a Number inode can collide.
      const stat = await fsp.stat(fullPath, { bigint: true });
      perfTick();
      const size = Number(stat.size);
      if (filters.minSize && filters.minSize > 0 && size < filters.minSize) return;

      // Some network filesystems report inode 0 — no identity, fall back to path.
      const id = stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : null;
      if (id) {
        if (seenIds.has(id)) { aliasSkipped++; return; }
        seenIds.add(id);
      }

      counter.walked++;
      sourceFiles.push({
        path: fullPath,
        name,
        id,
        size,
        modified: stat.mtime.toISOString(),
        ext: path.extname(fullPath).toLowerCase(),
        sourceLabel: label,
        root,
        isEmpty: size === 0,
      });
      emitProgress({ phase: 'walking', scanned: counter.walked, currentPath: fullPath });
    } catch (e) {
      warnings.push({ path: fullPath, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  // Then descend into subdirectories.
  for (const sub of subdirs) {
    if (cancelled) return;
    await walkCollect(sub, filters, exclusions, label, sourceFiles, warnings, counter, root);
  }
}

async function run() {
  perfPhase('walk');
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

  if (cancelled) { cacheSave(); parentPort.postMessage({ type: 'cancelled' }); return; }

  // Separate zero-byte files — grouped by name only, never content-hashed.
  const emptyFiles    = allFiles.filter(f =>  f.isEmpty);
  const nonEmptyFiles = allFiles.filter(f => !f.isEmpty);

  // ── Pass 2: group by size, boundary-hash only collisions ─────────────────
  const candidateFiles = sizeCandidates(nonEmptyFiles);
  // Files whose content couldn't be read: reported as their own bucket, never
  // as "not backed up" / "only in target".
  const unreadable = new Set();
  const candidateCount = candidateFiles.length;
  emitProgress({ phase: 'hashing', scanned: 0, total: candidateCount, currentPath: firstFolder }, true);
  perfPhase('boundary-hash', candidateCount);

  // boundary hash → file[]  (or quick-match key → file[] in quick mode)
  const byBoundaryHash = new Map();

  if (CONFIDENCE === 'quick') {
    // Quick: size + filename, zero content reads.
    for (const file of candidateFiles) {
      const key = 'Q:' + file.size + '|' + path.basename(file.path).toLowerCase();
      if (!byBoundaryHash.has(key)) byBoundaryHash.set(key, []);
      byBoundaryHash.get(key).push(file);
    }
    counter.hashed = candidateCount;
    emitProgress({ phase: 'hashing', scanned: candidateCount, total: candidateCount, currentPath: firstFolder }, true);
  } else await runPool(candidateFiles, CONCURRENCY, async (file) => {
    if (cancelled) return;
    try {
      let bHash = cacheGet(file, 'bh');
      if (bHash) {
        cacheStats.bhHits++;
      } else {
        bHash = await withRootLimit(file.path, () => hashFileBoundary(file.path, file.size));
        cachePut(file, 'bh', bHash);
        cacheStats.bhMisses++;
      }
      if (!byBoundaryHash.has(bHash)) byBoundaryHash.set(bHash, []);
      byBoundaryHash.get(bHash).push(file);

      counter.hashed++;
      perfTick();
      emitProgress({ phase: 'hashing', scanned: counter.hashed, total: candidateCount, currentPath: file.path });
    } catch (e) {
      unreadable.add(file.path);
      warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  if (cancelled) { cacheSave(); parentPort.postMessage({ type: 'cancelled' }); return; }

  // ── Pass 3: full SHA-256 only for boundary-hash collisions ───────────────
  const fullHashCandidates = [];
  if (CONFIDENCE === 'thorough') {
    for (const group of byBoundaryHash.values()) {
      if (group.length >= 2) fullHashCandidates.push(...group);
    }
  }

  const fullHashTotal = fullHashCandidates.length;
  let fullHashed = 0;

  emitProgress({ phase: 'verifying', scanned: 0, total: fullHashTotal, currentPath: firstFolder }, true);
  perfPhase('full-hash', fullHashTotal);

  const fileMap = new Map(); // fullHash → file[]

  await runPool(fullHashCandidates, CONCURRENCY, async (file) => {
    if (cancelled) return;
    try {
      let hash = cacheGet(file, 'fh');
      if (hash) {
        cacheStats.fhHits++;
      } else {
        hash = await withRootLimit(file.path, () => hashFileFull(file.path), STREAM_ROOT_LIMIT);
        cachePut(file, 'fh', hash);
        cacheStats.fhMisses++;
      }
      fullHashed++;
      perfTick();
      if (!fileMap.has(hash)) fileMap.set(hash, []);
      fileMap.get(hash).push({ ...file });
      emitProgress({ phase: 'verifying', scanned: fullHashed, total: fullHashTotal, currentPath: file.path });
    } catch (e) {
      unreadable.add(file.path);
      warnings.push({ path: file.path, reason: e.code === 'EBUSY' ? 'File locked' : e.message });
    }
  });

  if (cancelled) { cacheSave(); parentPort.postMessage({ type: 'cancelled' }); return; }
  perfPhaseEnd();

  if (CONFIDENCE !== 'thorough') {
    // Quick/Standard: the boundary (or quick-key) groups ARE the result set.
    for (const [key, files] of byBoundaryHash.entries()) {
      fileMap.set(key, files.map(f => ({ ...f })));
    }
  }

  // ── Census (compare mode only) ────────────────────────────────────────────
  // Built over non-empty files so it lines up with what was actually hashed;
  // zero-byte files are reported separately and never content-matched.
  let census = null;
  if (mode === 'compare') {
    census = buildCensus(nonEmptyFiles, fileMap, protectedFolders, targetFolders, unreadable);
    for (const problem of censusProblems(census)) console.error(`[census] INVARIANT FAILED ${problem}`);
    console.log(`[census] source ${census.roots.source.files.toLocaleString()} · target ${census.roots.target.files.toLocaleString()} · in both ${census.matched.targetFiles.toLocaleString()} (${(census.matched.bytes / 1073741824).toFixed(2)} GB) · source-only ${census.sourceOnly.files.toLocaleString()} · target-only ${census.targetOnly.files.toLocaleString()} · unreadable ${(census.unreadable.sourceFiles + census.unreadable.targetFiles).toLocaleString()}`);
  }

  // ── Duplicate groups (compare / simple modes) ────────────────────────────
  const groups = mode === 'verify' ? [] : buildGroups(fileMap, mode, autoMarkRule);

  // ── Verify report: is every source file in the backup? ───────────────────
  const verifyReport = mode === 'verify' ? buildVerifyReport(nonEmptyFiles, fileMap, unreadable) : null;

  // ── Empty file groups ─────────────────────────────────────────────────────
  const emptyGroups = (includeEmpty && emptyFiles.length > 0)
    ? emptyFiles.map(f => ({ ...f }))
    : [];

  if (aliasSkipped > 0) {
    warnings.push({
      path: '-',
      reason: `${aliasSkipped.toLocaleString()} file${aliasSkipped === 1 ? ' was' : 's were'} reached through more than one path and counted once`,
    });
  }

  perfSummary();
  cacheSave();
  parentPort.postMessage({
    type: 'done',
    result: {
      groups,
      emptyFiles: includeEmpty ? emptyGroups : [],
      totalScanned: counter.walked,
      totalHashed: counter.hashed,
      warnings,
      mode,
      confidence: CONFIDENCE,
      verifyReport,
      census,
    },
  });
}

run().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
});
