// Quarantine — the recoverable fallback when the OS Recycle Bin can't take a file.
//
// A file is only ever MOVED (rename) into a quarantine folder on the same
// volume, never copied across devices and never unlinked. Candidate folders,
// in order:
//   1. <top of the file's volume>/.dff-quarantine
//   2. <the scan root the file came from>/.dff-quarantine
//   3. <home>/.dff-quarantine
// If none can take a same-volume rename, quarantine fails and the caller
// reports the file as "not deleted".
//
// Each quarantine folder keeps an append-only manifest.jsonl: one JSON record
// per line ({op:'quarantine'|'restore', ...}). Appends are cheap, a torn last
// line is skipped on read, and nothing is ever rewritten, so an unreadable
// record can't wipe the others. A legacy manifest.json array (pre-Phase A,
// home folder only) is still read.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DIR_NAME = '.dff-quarantine';
const LOG_NAME = 'manifest.jsonl';
const LEGACY_NAME = 'manifest.json';

// Walk up from the file's folder while the device stays the same.
async function findVolumeRoot(filePath) {
  let cur = path.dirname(filePath);
  const { dev } = await fsp.stat(cur);
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    let st;
    try { st = await fsp.stat(parent); } catch { return cur; }
    if (st.dev !== dev) return cur;
    cur = parent;
  }
}

async function candidateDirs(filePath, { scanRoot, homeDir } = {}) {
  const dirs = [];
  try { dirs.push(path.join(await findVolumeRoot(filePath), DIR_NAME)); } catch { /* unreachable */ }
  if (scanRoot) dirs.push(path.join(scanRoot, DIR_NAME));
  if (homeDir) dirs.push(path.join(homeDir, DIR_NAME));
  return Array.from(new Set(dirs));
}

async function appendRecord(dir, record) {
  await fsp.appendFile(path.join(dir, LOG_NAME), JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Move one file into quarantine.
 * @param {string} filePath
 * @param {object} opts { scanRoot, homeDir, dirs?, rename? }  dirs/rename are test hooks
 * @returns {Promise<{ quarantinePath: string, dir: string }>}
 */
async function quarantineFile(filePath, opts = {}) {
  const rename = opts.rename || fsp.rename;
  const fileDev = (await fsp.stat(filePath)).dev;
  const errors = [];

  for (const dir of opts.dirs || await candidateDirs(filePath, opts)) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      if ((await fsp.stat(dir)).dev !== fileDev) { errors.push(`${dir}: different drive`); continue; }

      const dest = path.join(dir, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(filePath)}`);
      // Record intent first: if the move then fails, the reader ignores an
      // entry whose file isn't there; the reverse order could lose a file.
      await appendRecord(dir, { op: 'quarantine', originalPath: filePath, quarantinePath: dest, deletedAt: new Date().toISOString() });
      await rename(filePath, dest);
      return { quarantinePath: dest, dir };
    } catch (e) {
      errors.push(`${dir}: ${e.code || e.message}`);
    }
  }
  const err = new Error(`No recoverable location on this drive (${errors.join('; ')})`);
  err.code = 'ENOQUARANTINE';
  throw err;
}

async function readRecords(dir) {
  const records = [];
  try {
    const legacy = JSON.parse(await fsp.readFile(path.join(dir, LEGACY_NAME), 'utf8'));
    if (Array.isArray(legacy)) for (const e of legacy) records.push({ op: 'quarantine', ...e });
  } catch { /* none */ }
  let text = '';
  try { text = await fsp.readFile(path.join(dir, LOG_NAME), 'utf8'); } catch { /* none */ }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* torn or corrupt line — skip just this one */ }
  }
  return records;
}

// Live entries (quarantined, not restored, file still present) across dirs.
async function listQuarantine(dirs) {
  const out = [];
  for (const dir of Array.from(new Set(dirs))) {
    const live = new Map();
    for (const r of await readRecords(dir)) {
      if (r.op === 'quarantine' && r.quarantinePath) live.set(r.quarantinePath, r);
      else if (r.op === 'restore') live.delete(r.quarantinePath);
    }
    for (const r of live.values()) {
      try { await fsp.access(r.quarantinePath); } catch { continue; }
      out.push({ originalPath: r.originalPath, quarantinePath: r.quarantinePath, deletedAt: r.deletedAt });
    }
  }
  return out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

async function restoreFile(quarantinePath, dirs) {
  const dir = path.dirname(quarantinePath);
  // Only act inside a known quarantine folder — never an arbitrary path.
  if (!Array.from(new Set(dirs)).some(d => path.resolve(d) === path.resolve(dir))) {
    return { success: false, error: 'Not in a known quarantine folder' };
  }
  const entry = (await listQuarantine([dir])).find(e => e.quarantinePath === quarantinePath);
  if (!entry) return { success: false, error: 'Not found in quarantine' };

  try {
    await fsp.access(entry.originalPath);
    return { success: false, error: 'A file already exists at the original location' };
  } catch { /* free — good */ }

  try {
    await fsp.mkdir(path.dirname(entry.originalPath), { recursive: true });
    await fsp.rename(entry.quarantinePath, entry.originalPath);
    await appendRecord(dir, { op: 'restore', quarantinePath, restoredAt: new Date().toISOString() });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { quarantineFile, listQuarantine, restoreFile, findVolumeRoot, candidateDirs, DIR_NAME };
