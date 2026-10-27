import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'worker_threads';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyseRoots } from '../main/roots.js';

// Runs the REAL scan worker against a temp tree (no Electron needed).
const WORKER = path.resolve(__dirname, '../main/scanWorker.js');

function runScan(workerData) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { workerData: { filters: {}, exclusions: [], cachePath: null, ...workerData } });
    w.on('message', (m) => {
      if (m.type === 'done') { resolve(m.result); w.terminate(); }
      else if (m.type === 'error') { reject(new Error(m.message)); w.terminate(); }
    });
    w.on('error', reject);
  });
}

let tmp;
const write = (rel, content) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-worker-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const allPaths = (result) => result.groups.flatMap(g => g.files.map(f => f.path));

describe('scanWorker (real worker thread)', () => {
  it('finds a plain duplicate in compare mode and marks only the target copy', async () => {
    const a = write('src/a.jpg', 'same content');
    const b = write('tgt/b.jpg', 'same content');
    const r = await runScan({ mode: 'compare', protectedFolders: [path.join(tmp, 'src')], targetFolders: [path.join(tmp, 'tgt')], confidence: 'thorough' });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].autoMarked).toEqual([b]);
    expect(allPaths(r)).toContain(a);
  });

  it('counts a hard-linked file once instead of calling it a duplicate of itself', async () => {
    const a = write('src/a.jpg', 'only copy');
    fs.mkdirSync(path.join(tmp, 'tgt'));
    fs.linkSync(a, path.join(tmp, 'tgt', 'a-link.jpg'));
    const r = await runScan({ mode: 'compare', protectedFolders: [path.join(tmp, 'src')], targetFolders: [path.join(tmp, 'tgt')], confidence: 'thorough' });
    expect(r.groups).toHaveLength(0);
    expect(r.warnings.some(w => /more than one path/.test(w.reason))).toBe(true);
  });

  it('verify mode reports source files missing from the backup', async () => {
    write('src/kept.jpg', 'kept');
    write('src/lost.cr2', 'raw photo never copied');
    write('backup/kept-copy.jpg', 'kept');
    write('backup/extra.txt', 'only in backup');
    const r = await runScan({ mode: 'verify', protectedFolders: [path.join(tmp, 'src')], targetFolders: [path.join(tmp, 'backup')], confidence: 'thorough' });
    expect(r.verifyReport.missing.map(f => path.basename(f.path))).toEqual(['lost.cr2']);
    expect(r.verifyReport.backedUp).toHaveLength(1);
    expect(r.verifyReport.backupOnly.map(f => path.basename(f.path))).toEqual(['extra.txt']);
  });

  it('scans file types outside the old allowlist (RAW, TIFF, no extension)', async () => {
    write('src/a.nef', 'raw');
    write('tgt/a-copy.nef', 'raw');
    write('src/scan.tiff', 'tiff');
    write('tgt/scan-copy.tiff', 'tiff');
    write('src/README', 'no ext');
    write('tgt/README-copy', 'no ext');
    const r = await runScan({ mode: 'compare', protectedFolders: [path.join(tmp, 'src')], targetFolders: [path.join(tmp, 'tgt')], confidence: 'thorough' });
    expect(r.groups).toHaveLength(3);
  });

  it('never offers protected files for deletion when the protected folder is inside the target', async () => {
    const protectedRoot = path.join(tmp, 'all', 'Photos');
    const targetRoot = path.join(tmp, 'all');
    const keep = write('all/Photos/a.jpg', 'photo');
    const dupe = write('all/Backup/a.jpg', 'photo');
    write('all/Photos/only.jpg', 'unique photo');

    const { blocked, excludeFromTarget } = analyseRoots({ protectedRoots: [protectedRoot], targetRoots: [targetRoot], platform: process.platform });
    expect(blocked).toEqual([]);

    const r = await runScan({
      mode: 'compare', protectedFolders: [protectedRoot], targetFolders: [targetRoot], confidence: 'thorough',
      platform: process.platform, rootExcludes: excludeFromTarget,
    });

    const marked = r.groups.flatMap(g => g.autoMarked);
    expect(marked).toEqual([dupe]);
    expect(marked).not.toContain(keep);

    // Census: the protected folder must not appear as a target folder.
    const targetPaths = r.census.folders.flatMap(f => f.matchedPaths);
    expect(targetPaths).not.toContain(keep);
    expect(r.census.roots.target.files).toBe(1);
  });
});
