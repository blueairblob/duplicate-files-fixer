// integrityWorker.js — runs in a worker thread. Walks one archive folder and
// hashes every file (full SHA-256, no cache: the point is to read the bytes
// as they are now). Reports progress; honours cancel.
//
// workerData: { root, concurrency? }
// messages out: progress { done, total, bytes, path } · done { entries } · cancelled · error

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { RECORD_NAME } = require('./integrity');

const ROOT = workerData.root;
const CONCURRENCY = Math.max(1, Number(workerData.concurrency) || 3); // full reads: few at once
// Holdfast's own files, and the pre-rename quarantine folder, are not part of the archive.
const SKIP_DIRS = new Set(['.holdfast-quarantine', '.dff-quarantine']);
const SKIP_FILES = new Set([RECORD_NAME, RECORD_NAME + '.tmp']);

let cancelled = false;
parentPort.on('message', (m) => { if (m && m.type === 'cancel') cancelled = true; });

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

async function walk(dir, out) {
  if (cancelled) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, out); }
    else if (e.isFile() && !SKIP_FILES.has(e.name) && !e.name.endsWith('.holdfast-partial')) out.push(full);
  }
}

function hash(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function run() {
  const files = [];
  await walk(ROOT, files);
  const total = files.length;
  const entries = [];
  let done = 0, bytes = 0, last = 0, next = 0;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, total)) }, async () => {
    while (next < total && !cancelled) {
      const p = files[next++];
      try {
        const st = await fsp.stat(p);
        const h = await hash(p);
        entries.push({ p: rel(p), s: st.size, m: st.mtime.toISOString(), h });
        bytes += st.size;
      } catch (e) {
        entries.push({ p: rel(p), s: null, m: null, h: null, error: e.code === 'EBUSY' ? 'File locked' : e.message });
      }
      done++;
      const now = Date.now();
      if (now - last > 150 || done === total) { last = now; parentPort.postMessage({ type: 'progress', done, total, bytes, path: p }); }
    }
  }));

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }
  parentPort.postMessage({ type: 'done', entries });
}

run().catch(e => parentPort.postMessage({ type: 'error', message: e.message }));
