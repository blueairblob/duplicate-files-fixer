#!/usr/bin/env electron
// phase-a-check.js — end-to-end check of the Phase A safety rules against a
// real network share and the real Recycle Bin, using the app's own modules
// (roots/system, scan worker, deleteGuard, deleteService) inside Electron.
//
//   npx electron tools/phase-a-check.js <mapped-root> <unc-root>
//   e.g. npx electron tools/phase-a-check.js Z:\ \\192.168.0.101\public
//
// It only touches files it creates: a dff-phase-a-<stamp> folder on the share
// and in %TEMP%. Everything is removed at the end, except one test file it
// sends to the Windows Recycle Bin (step 8) — empty the bin to remove it.

const { app, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const SRC = path.join(__dirname, '..', 'src', 'main');
const { checkRoots } = require(path.join(SRC, 'system'));
const { buildSession, planDeletion } = require(path.join(SRC, 'deleteGuard'));
const { createDeleteService, statForDelete } = require(path.join(SRC, 'deleteService'));

const [mappedRoot, uncRoot] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!mappedRoot || !uncRoot) {
  console.error('usage: npx electron tools/phase-a-check.js <mapped-root> <unc-root>');
  process.exit(2);
}

const STAMP = `dff-phase-a-${Date.now()}`;
const NAS = path.join(mappedRoot, STAMP);
const NAS_UNC = path.join(uncRoot, STAMP);
const LOCAL = path.join(os.tmpdir(), STAMP);
const USERDATA = path.join(os.tmpdir(), STAMP + '-userdata');

const results = [];
function check(step, ok, detail) {
  results.push({ step, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`);
}
function info(step, detail) {
  results.push({ step, ok: null, detail });
  console.log(`INFO  ${step}  — ${detail}`);
}

const content = {};
for (const k of ['A', 'B', 'C', 'D', 'X']) content[k] = crypto.randomBytes(200 * 1024 + k.charCodeAt(0));
async function put(p, key) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content[key]); return p; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function runScan(workerData) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(SRC, 'scanWorker.js'), {
      workerData: { filters: {}, exclusions: [], cachePath: path.join(USERDATA, 'dff-signature-cache.json'), platform: process.platform, ...workerData },
    });
    w.on('message', (m) => {
      if (m.type === 'done') { resolve(m.result); w.terminate(); }
      else if (m.type === 'error') { reject(new Error(m.message)); w.terminate(); }
    });
    w.on('error', reject);
  });
}

async function scanCompare(protectedFolders, targetFolders) {
  const config = { mode: 'compare', protectedFolders, targetFolders, confidence: 'standard' };
  const roots = await checkRoots(config);
  const result = await runScan({ ...config, rootExcludes: roots.excludeFromTarget });
  return { result, session: buildSession(result, config, process.platform) };
}

const under = (p, dir) => p.toLowerCase().startsWith(dir.toLowerCase() + path.sep);
const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

async function main() {
  await fsp.mkdir(USERDATA, { recursive: true });
  const svc = createDeleteService({ userDataDir: USERDATA, homeDir: os.homedir(), trash: (p) => shell.trashItem(p) });

  // ── Fixtures ──
  for (const k of ['A', 'B', 'C', 'D']) await put(path.join(LOCAL, 'photos', `${k.toLowerCase()}.jpg`), k);
  await put(path.join(LOCAL, 'simple', 'x.jpg'), 'X');
  await put(path.join(LOCAL, 'simple', 'x-copy.jpg'), 'X');
  await put(path.join(NAS, 'keep', 'a.jpg'), 'A');
  await put(path.join(NAS, 'keep', 'b.jpg'), 'B');
  for (const k of ['A', 'B', 'C', 'D']) await put(path.join(NAS, 'dupes', `${k.toLowerCase()}1.jpg`), k);
  console.log(`Fixtures: ${NAS}  and  ${LOCAL}\n`);

  // ── Diagnostics: does the share give stable file identities? ──
  const viaMapped = await statForDelete(path.join(NAS, 'dupes', 'a1.jpg'));
  const viaUnc = await statForDelete(path.join(NAS_UNC, 'dupes', 'a1.jpg'));
  info('SMB file identity', `mapped=${viaMapped.id} unc=${viaUnc.id} → ${viaMapped.id && viaMapped.id === viaUnc.id ? 'same file detected by identity' : 'identity NOT usable on this share (root checks still apply)'}`);

  // What does the Recycle Bin do with a network file? (Phase A never uses it for these.)
  const probe = await put(path.join(NAS, 'trash-probe.jpg'), 'X');
  try {
    await shell.trashItem(probe);
    info('Recycle Bin on the share', `trashItem SUCCEEDED; file ${await exists(probe) ? 'still there' : 'gone'} — check the NAS recycle bin; if not there, it was permanently deleted`);
  } catch (e) {
    info('Recycle Bin on the share', `trashItem refused (${e.message}); file ${await exists(probe) ? 'kept' : 'gone'}`);
  }

  // ── 1. Same folder via mapped drive and UNC ──
  const r1 = await checkRoots({ mode: 'compare', protectedFolders: [NAS_UNC], targetFolders: [NAS] });
  check('1  mapped drive vs UNC path is refused', r1.blocked.length === 1, r1.blocked[0]?.reason);

  // ── 2. Overlap ──
  const keep = path.join(NAS, 'keep');
  const s2 = await scanCompare([keep], [NAS]);
  const markedUnderKeep = s2.result.groups.flatMap(g => g.autoMarked).filter(p => under(p, keep));
  const targetUnderKeep = s2.result.groups.flatMap(g => g.files).filter(f => f.sourceLabel === 'target' && under(f.path, keep));
  check('2a protected inside target: nothing under keep is deletable', markedUnderKeep.length === 0 && targetUnderKeep.length === 0,
    `${s2.result.groups.length} groups, ${s2.result.census.roots.target.files} target files`);
  const rejectKeep = planDeletion([path.join(keep, 'a.jpg')], s2.session);
  check('2a guard rejects a protected path even if asked', rejectKeep.items.length === 0, rejectKeep.rejected[0]?.reason);
  const r2b = await checkRoots({ mode: 'compare', protectedFolders: [NAS], targetFolders: [keep] });
  check('2b target inside protected is refused', r2b.blocked.length === 1, r2b.blocked[0]?.reason);

  // ── 3. NAS delete goes to same-drive quarantine ──
  const dupes = path.join(NAS, 'dupes');
  const s3 = await scanCompare([path.join(LOCAL, 'photos')], [dupes]);
  const a1 = path.join(dupes, 'a1.jpg');
  const b1 = path.join(dupes, 'b1.jpg');
  const d3 = await svc.deleteFiles(s3.session, { files: [{ path: a1 }, { path: b1 }] });
  const q = await svc.listQuarantine();
  const qa1 = q.find(e => e.originalPath === a1);
  const qb1 = q.find(e => e.originalPath === b1);
  check('3  NAS files quarantined, not recycled', d3.quarantined.length === 2 && d3.trashed.length === 0,
    `quarantined=${d3.quarantined.length} trashed=${d3.trashed.length} skipped=${JSON.stringify(d3.skipped)} failed=${JSON.stringify(d3.failed)}`);
  check('3  quarantine folder is on the same drive', qa1 && path.dirname(qa1.quarantinePath).toLowerCase() === path.join(mappedRoot, '.dff-quarantine').toLowerCase(),
    qa1 && qa1.quarantinePath);
  check('3  freed bytes counted', d3.freedBytes === content.A.length + content.B.length, `${d3.freedBytes}`);

  // ── 4. Restore ──
  const r4 = qa1 ? await svc.restore(qa1.quarantinePath) : { success: false, error: 'nothing to restore' };
  check('4  restore puts the file back', r4.success && await exists(a1), r4.error);

  // ── 5. Changed since scan ──
  const c1 = path.join(dupes, 'c1.jpg');
  const s5 = await scanCompare([path.join(LOCAL, 'photos')], [dupes]);
  await sleep(2100); // coarse SMB timestamps
  await fsp.writeFile(c1, crypto.randomBytes(content.C.length));
  // Immediately after the edit: Windows' SMB client may still serve cached
  // timestamps (FileInfoCacheLifetime, ~10s), so the content check is what
  // catches it. Either way the file must stay.
  const d5 = await svc.deleteFiles(s5.session, { files: [{ path: c1 }] });
  check('5  file edited just now is not deleted', d5.skipped.length === 1 && await exists(c1), d5.skipped[0]?.reason);
  await sleep(11000);
  const d5b = await svc.deleteFiles(s5.session, { files: [{ path: c1 }] });
  check('5  file changed since scan is not deleted (after SMB cache expiry)', d5b.skipped.some(x => /changed since the scan/.test(x.reason)) && await exists(c1), d5b.skipped[0]?.reason);

  // ── 6. Kept copy gone ──
  const d1 = path.join(dupes, 'd1.jpg');
  const s6 = await scanCompare([path.join(LOCAL, 'photos')], [dupes]);
  await fsp.rename(path.join(LOCAL, 'photos', 'd.jpg'), path.join(LOCAL, 'photos', 'd-renamed.jpg'));
  const d6 = await svc.deleteFiles(s6.session, { files: [{ path: d1 }] });
  check('6  kept copy missing → not deleted', d6.skipped.some(x => /kept copy is missing/.test(x.reason)) && await exists(d1), JSON.stringify(d6.skipped));

  // ── 7. Every copy selected ──
  const simpleCfg = { mode: 'simple', protectedFolders: [], targetFolders: [path.join(LOCAL, 'simple')], confidence: 'standard' };
  const r7 = await runScan(simpleCfg);
  const s7 = buildSession(r7, simpleCfg, process.platform);
  const both = r7.groups[0] ? r7.groups[0].files.map(f => f.path) : [];
  const p7 = planDeletion(both, s7);
  check('7  removing every copy needs acknowledgement', both.length === 2 && p7.items.length === 0, p7.rejected[0]?.reason);

  // ── 8. Local delete goes to the Recycle Bin ──
  const xCopy = r7.groups[0]?.autoMarked[0];
  const d8 = xCopy ? await svc.deleteFiles(s7, { files: [{ path: xCopy }] }) : { trashed: [] };
  check('8  local duplicate goes to the Recycle Bin', d8.trashed.length === 1 && !(await exists(xCopy)), `${xCopy} → ${JSON.stringify({ trashed: d8.trashed, quarantined: d8.quarantined, failed: d8.failed })}`);

  // Leftover quarantined test file (b1) — removed in cleanup.
  return { leftovers: [qb1 && qb1.quarantinePath].filter(Boolean), ourQuarantinePaths: [qa1, qb1].filter(Boolean).map(e => e.quarantinePath) };
}

async function cleanup(leftovers, ourQuarantinePaths = []) {
  const ours = new Set(ourQuarantinePaths);
  for (const p of leftovers) await fsp.rm(p, { force: true }).catch(() => {});
  // Remove the share's quarantine folder only if everything in it is ours.
  const qdir = path.join(mappedRoot, '.dff-quarantine');
  try {
    const entries = await fsp.readdir(qdir);
    const manifest = await fsp.readFile(path.join(qdir, 'manifest.jsonl'), 'utf8').catch(() => '');
    const allOurs = manifest.split('\n').filter(Boolean).every(l => {
      try { const r = JSON.parse(l); return (r.originalPath || '').includes(STAMP) || ours.has(r.quarantinePath); } catch { return false; }
    });
    if (allOurs && entries.every(e => e === 'manifest.jsonl')) await fsp.rm(qdir, { recursive: true, force: true });
    else console.log(`Left ${qdir} in place (it holds entries that aren't from this run).`);
  } catch { /* not created */ }
  for (const d of [NAS, LOCAL, USERDATA]) await fsp.rm(d, { recursive: true, force: true }).catch(e => console.log(`cleanup: ${d}: ${e.message}`));
}

app.whenReady().then(async () => {
  let leftovers = [];
  let ourQuarantinePaths = [];
  try {
    ({ leftovers, ourQuarantinePaths } = await main());
  } catch (e) {
    check('run', false, e.stack);
  }
  await cleanup(leftovers, ourQuarantinePaths);
  const failed = results.filter(r => r.ok === false).length;
  console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
});
