#!/usr/bin/env node
// bench-walk.js — times a scan of a synthetic "many small folders" tree, the
// shape of a typical photo archive. Builds the tree, runs the real scan
// worker (Quick match: walk-dominated), prints timings, then deletes the tree.
//
//   node tools/bench-walk.js <parent-dir> [folders=1500] [filesPerFolder=4] [worker=src/main/scanWorker.js]
//
// Run it against a NAS path to see the effect of folder-level concurrency.
// Set UV_THREADPOOL_SIZE=64 first, as the app does.

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const [parent, foldersArg, perArg, workerArg] = process.argv.slice(2);
if (!parent) {
  console.error('usage: node tools/bench-walk.js <parent-dir> [folders] [filesPerFolder] [worker]');
  process.exit(2);
}
const FOLDERS = Number(foldersArg) || 1500;
const PER = Number(perArg) || 4;
const WORKER = path.resolve(workerArg || path.join(__dirname, '..', 'src', 'main', 'scanWorker.js'));
const root = path.join(parent, `holdfast-bench-walk-${Date.now()}`);

function scan() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const w = new Worker(WORKER, {
      workerData: { mode: 'simple', protectedFolders: [], targetFolders: [root], filters: {}, exclusions: [], confidence: 'quick', cachePath: null },
    });
    w.on('message', (m) => {
      if (m.type === 'done') { resolve({ ms: Date.now() - t0, files: m.result.totalScanned }); w.terminate(); }
      else if (m.type === 'error') { reject(new Error(m.message)); w.terminate(); }
    });
    w.on('error', reject);
  });
}

(async () => {
  const t0 = Date.now();
  for (let d = 0; d < FOLDERS; d++) {
    const dir = path.join(root, `y${d % 20}`, `album-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < PER; f++) fs.writeFileSync(path.join(dir, `IMG_${f}.jpg`), `${d}-${f}`);
  }
  console.log(`fixture: ${FOLDERS} folders × ${PER} files in ${((Date.now() - t0) / 1000).toFixed(1)}s at ${root}`);
  try {
    for (let run = 1; run <= 2; run++) {
      const r = await scan();
      console.log(`run ${run}: ${r.files} files in ${(r.ms / 1000).toFixed(2)}s (${Math.round(r.files / (r.ms / 1000))} files/s)  worker=${path.basename(WORKER)}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
