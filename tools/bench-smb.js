#!/usr/bin/env node
// bench-smb.js — measures boundary-read throughput (open + head 4KB + tail 4KB
// + close, the same op the scan's compare phase performs) against a folder,
// serially and at several concurrency levels. Run it against the NAS share:
//
//   set UV_THREADPOOL_SIZE=64 && node bench-smb.js "Z:\photos\2007_pictures"
//   (PowerShell:  $env:UV_THREADPOOL_SIZE=64; node bench-smb.js "Z:\photos\2007_pictures")
//
// Reading the results:
//   - serial ≈ parallel at all levels  → the SMB client/AV serializes per-file
//     ops; no client-side tuning will help much → the NAS-agent route is the fix
//   - parallel scales with concurrency → the app's pipeline is the bottleneck
//     and it's fixable in scanWorker
//   - parallel scales only until ~4    → UV_THREADPOOL_SIZE didn't take effect

const fsp = require('fs/promises');
const path = require('path');

const BOUNDARY_BYTES = 4096;
const SAMPLE_FILES = 200;

async function collectFiles(dir, out) {
  if (out.length >= SAMPLE_FILES) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= SAMPLE_FILES) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '@eaDir' || e.name.startsWith('.')) continue;
      await collectFiles(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
}

async function boundaryRead(filePath) {
  const fd = await fsp.open(filePath, 'r');
  try {
    const st = await fd.stat();
    const head = Buffer.alloc(Math.min(BOUNDARY_BYTES, st.size));
    await fd.read(head, 0, head.length, 0);
    if (st.size > BOUNDARY_BYTES) {
      const tail = Buffer.alloc(BOUNDARY_BYTES);
      await fd.read(tail, 0, BOUNDARY_BYTES, st.size - BOUNDARY_BYTES);
    }
  } finally {
    await fd.close();
  }
}

async function runPool(items, width, task) {
  let i = 0;
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try { await task(item); } catch { /* count attempts, ignore errors */ }
    }
  });
  await Promise.all(runners);
}

async function bench(files, width) {
  const t0 = Date.now();
  await runPool(files, width, boundaryRead);
  const secs = (Date.now() - t0) / 1000;
  return files.length / secs;
}

(async () => {
  const root = process.argv[2];
  if (!root) { console.error('usage: node bench-smb.js <folder>'); process.exit(1); }

  console.log(`UV_THREADPOOL_SIZE = ${process.env.UV_THREADPOOL_SIZE || '(unset — pool is 4)'}`);
  console.log(`Collecting up to ${SAMPLE_FILES} files under ${root} …`);
  const files = [];
  await collectFiles(root, files);
  if (files.length < 20) { console.error(`only found ${files.length} files — pick a fuller folder`); process.exit(1); }
  console.log(`Benchmarking boundary reads on ${files.length} files\n`);

  // Warm-up pass so directory/metadata caches don't skew the serial run
  await runPool(files.slice(0, 20), 4, boundaryRead);

  for (const width of [1, 4, 8, 16, 32]) {
    const rate = await bench(files, width);
    const bar = '#'.repeat(Math.max(1, Math.round(rate / 5)));
    console.log(`concurrency ${String(width).padStart(2)}: ${rate.toFixed(1).padStart(7)} files/s  ${bar}`);
  }

  console.log('\nInterpretation:');
  console.log('  flat across all levels     -> SMB client or antivirus serializes; NAS-side agent is the fix');
  console.log('  scales past 4              -> thread pool fix works; app pipeline needs tuning');
  console.log('  plateaus exactly at 4      -> UV_THREADPOOL_SIZE not reaching the process');
})();
