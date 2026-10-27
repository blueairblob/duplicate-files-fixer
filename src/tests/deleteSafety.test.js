import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildSession, planDeletion, forgetPaths } from '../main/deleteGuard.js';
import { executeDeletion, makeIsNetworkPath } from '../main/deleteFiles.js';
import { quarantineFile, listQuarantine, restoreFile, candidateDirs } from '../main/quarantine.js';

// ── deleteGuard ──────────────────────────────────────────────────────────────

const f = (p, sourceLabel = 'target', extra = {}) => ({ path: p, sourceLabel, size: 10, modified: '2026-01-01T00:00:00.000Z', id: null, ...extra });

function session(groups, config = { mode: 'compare', protectedFolders: ['D:\\Photos'] }) {
  return buildSession({ groups, confidence: 'standard' }, config, 'win32');
}

describe('planDeletion', () => {
  const groups = [
    { id: 0, files: [f('D:\\Photos\\a.jpg', 'protected'), f('E:\\Backup\\a.jpg'), f('E:\\Backup\\a (1).jpg')] },
    { id: 1, files: [f('E:\\x\\b.jpg'), f('E:\\y\\b.jpg')] },
  ];

  it('rejects everything without a session', () => {
    const r = planDeletion(['E:\\Backup\\a.jpg'], null);
    expect(r.items).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/out of date/);
  });

  it('never deletes a protected file, even if the renderer asks', () => {
    const r = planDeletion(['D:\\Photos\\a.jpg'], session(groups));
    expect(r.items).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/Protected/);
  });

  it('rejects target-labelled paths that sit under a protected root', () => {
    const s = session([{ id: 0, files: [f('D:\\Photos\\sub\\c.jpg'), f('E:\\c.jpg')] }]);
    const r = planDeletion(['d:\\photos\\sub\\c.jpg'.replace('d:\\photos', 'D:\\Photos')], s);
    expect(r.items).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/Protected/);
  });

  it('rejects paths that are not in the scan results', () => {
    const r = planDeletion(['C:\\Windows\\notepad.exe'], session(groups));
    expect(r.rejected[0].reason).toMatch(/Not part/);
  });

  it('prefers the protected copy as the kept counterpart', () => {
    const r = planDeletion(['E:\\Backup\\a.jpg', 'E:\\Backup\\a (1).jpg'], session(groups));
    expect(r.items.map(i => i.counterpart)).toEqual(['D:\\Photos\\a.jpg', 'D:\\Photos\\a.jpg']);
  });

  it('refuses to remove every copy unless acknowledged', () => {
    const s = session(groups);
    const both = ['E:\\x\\b.jpg', 'E:\\y\\b.jpg'];
    expect(planDeletion(both, s).items).toEqual([]);
    const ok = planDeletion(both, s, { allowNoSurvivor: true });
    expect(ok.items).toHaveLength(2);
    expect(ok.items.every(i => i.counterpart === null)).toBe(true);
  });

  it('forgets deleted paths so a repeat request is rejected', () => {
    const s = session(groups);
    forgetPaths(s, ['E:\\x\\b.jpg']);
    expect(planDeletion(['E:\\x\\b.jpg'], s).rejected[0].reason).toMatch(/Not part/);
    // and the survivor is now alone in its group
    expect(planDeletion(['E:\\y\\b.jpg'], s).rejected[0].reason).toMatch(/every copy/);
  });
});

// ── executeDeletion (fake deps) ──────────────────────────────────────────────

function fakeDeps(over = {}) {
  const stats = {
    '/t/a': { size: 10, modified: 'm1', id: '1:1' },
    '/k/a': { size: 10, modified: 'm2', id: '1:2' },
  };
  const calls = { trash: [], quarantine: [], hash: [] };
  return {
    calls,
    deps: {
      stat: async (p) => { if (!stats[p]) throw new Error('ENOENT'); return stats[p]; },
      hash: async (p) => { calls.hash.push(p); return 'h'; },
      trash: async (p) => { calls.trash.push(p); },
      quarantine: async (p) => { calls.quarantine.push(p); return { quarantinePath: '/q/' + p }; },
      isNetworkPath: () => false,
      verifyContent: false,
      ...over,
    },
    stats,
  };
}
const item = (over = {}) => ({
  path: '/t/a', file: { size: 10, modified: 'm1', id: '1:1' },
  counterpart: '/k/a', counterpartFile: { size: 10, modified: 'm2', id: '1:2' }, ...over,
});

describe('executeDeletion', () => {
  it('trashes a verified duplicate and counts freed bytes', async () => {
    const { deps, calls } = fakeDeps();
    const r = await executeDeletion([item()], deps);
    expect(r.trashed).toEqual(['/t/a']);
    expect(r.freedBytes).toBe(10);
    expect(calls.hash).toEqual([]); // thorough scan + unchanged kept copy: stat checks only
  });

  it('skips a file that changed since the scan', async () => {
    const { deps, stats } = fakeDeps();
    stats['/t/a'] = { ...stats['/t/a'], modified: 'm9' };
    const r = await executeDeletion([item()], deps);
    expect(r.skipped[0].reason).toMatch(/changed since the scan/);
    expect(r.trashed).toEqual([]);
  });

  it('skips when the kept copy is missing', async () => {
    const { deps, stats } = fakeDeps();
    delete stats['/k/a'];
    const r = await executeDeletion([item()], deps);
    expect(r.skipped[0].reason).toMatch(/kept copy is missing/);
  });

  it('skips when the kept copy is the same physical file', async () => {
    const { deps, stats } = fakeDeps();
    stats['/k/a'] = { ...stats['/k/a'], id: '1:1' };
    const r = await executeDeletion([item()], deps);
    expect(r.skipped[0].reason).toMatch(/Same physical file/);
  });

  it('hashes when the kept copy changed, even after a thorough scan', async () => {
    const { deps, calls, stats } = fakeDeps({ hash: async (p) => (p === '/t/a' ? 'x' : 'y') });
    stats['/k/a'] = { ...stats['/k/a'], modified: 'm3' };
    const r = await executeDeletion([item()], deps);
    expect(r.skipped[0].reason).toMatch(/no longer match/);
    expect(calls.trash).toEqual([]);
  });

  it('hashes for quick/standard scans', async () => {
    const { deps, calls } = fakeDeps({ verifyContent: true });
    await executeDeletion([item()], deps);
    expect(calls.hash.sort()).toEqual(['/k/a', '/t/a']);
  });

  it('sends network paths straight to quarantine', async () => {
    const { deps, calls } = fakeDeps({ isNetworkPath: () => true });
    const r = await executeDeletion([item()], deps);
    expect(calls.trash).toEqual([]);
    expect(r.quarantined).toEqual(['/t/a']);
  });

  it('falls back to quarantine when the Recycle Bin fails', async () => {
    const { deps } = fakeDeps({ trash: async () => { throw new Error('no trash'); } });
    const r = await executeDeletion([item()], deps);
    expect(r.quarantined).toEqual(['/t/a']);
  });

  it('never permanently deletes: no trash and no quarantine means "not deleted"', async () => {
    const { deps } = fakeDeps({
      trash: async () => { throw new Error('no trash'); },
      quarantine: async () => { throw new Error('No recoverable location'); },
    });
    const r = await executeDeletion([item()], deps);
    expect(r.failed).toHaveLength(1);
    expect(r.freedBytes).toBe(0);
  });
});

describe('executeDeletion — as a job (Phase C)', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => item({ path: `/t/${i}` }));
  const statsFor = (n) => {
    const st = { '/k/a': { size: 10, modified: 'm2', id: '1:2' } };
    for (let i = 0; i < n; i++) st[`/t/${i}`] = { size: 10, modified: 'm1', id: '1:1' };
    return st;
  };

  it('always hashes network files, even after a thorough scan', async () => {
    const { deps, calls } = fakeDeps({ isNetworkPath: () => true });
    await executeDeletion([item()], deps);
    expect(calls.hash.sort()).toEqual(['/k/a', '/t/a']);
  });

  it('stops when cancelled and leaves the rest in place', async () => {
    let n = 0;
    const st = statsFor(10);
    const { deps } = fakeDeps({
      stat: async (p) => st[p],
      trash: async () => { n++; },
      concurrency: 1,
    });
    deps.isCancelled = () => n >= 3;
    const r = await executeDeletion(many(10), deps);
    expect(r.trashed).toHaveLength(3);
    expect(r.skipped.filter(x => /Cancelled/.test(x.reason))).toHaveLength(7);
    expect(r.cancelled).toBe(true);
  });

  it('checks files in parallel but moves them one at a time', async () => {
    const st = statsFor(12);
    let inFlightStat = 0, maxStat = 0, inFlightMove = 0, maxMove = 0;
    const tick = () => new Promise(r => setTimeout(r, 2));
    const { deps } = fakeDeps({
      stat: async (p) => { inFlightStat++; maxStat = Math.max(maxStat, inFlightStat); await tick(); inFlightStat--; return st[p]; },
      trash: async () => { inFlightMove++; maxMove = Math.max(maxMove, inFlightMove); await tick(); inFlightMove--; },
      concurrency: 4,
    });
    const r = await executeDeletion(many(12), deps);
    expect(r.trashed).toHaveLength(12);
    expect(maxStat).toBeGreaterThan(1);
    expect(maxMove).toBe(1);
  });

  it('reports progress for every file', async () => {
    const st = statsFor(5);
    const seen = [];
    const { deps } = fakeDeps({ stat: async (p) => st[p], onProgress: (p) => seen.push(p.done) });
    await executeDeletion(many(5), deps);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('makeIsNetworkPath', () => {
  it('flags UNC and mapped drives on Windows only', () => {
    const isNet = makeIsNetworkPath('win32', [{ local: 'Z:', remote: '\\\\nas\\s' }]);
    expect(isNet('\\\\nas\\s\\a')).toBe(true);
    expect(isNet('z:\\a')).toBe(true);
    expect(isNet('C:\\a')).toBe(false);
    expect(makeIsNetworkPath('linux', [])('//nas/a')).toBe(false);
  });
});

// ── quarantine (real temp folders) ───────────────────────────────────────────

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-q-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('quarantine', () => {
  it('moves a file into a same-volume quarantine and restores it', async () => {
    const scanRoot = path.join(tmp, 'root');
    const file = path.join(scanRoot, 'sub', 'a.jpg');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'data');

    // Explicit dirs keep the test inside tmp (never touch the real volume root).
    const dirs = [path.join(scanRoot, '.dff-quarantine')];
    const { quarantinePath, dir } = await quarantineFile(file, { dirs });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(quarantinePath, 'utf8')).toBe('data');

    const listed = await listQuarantine([dir]);
    expect(listed).toEqual([expect.objectContaining({ originalPath: file, quarantinePath })]);

    expect(await restoreFile(quarantinePath, [dir])).toEqual({ success: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('data');
    expect(await listQuarantine([dir])).toEqual([]);
  });

  it('fails instead of deleting when no location accepts a same-volume move', async () => {
    const file = path.join(tmp, 'a.jpg');
    fs.writeFileSync(file, 'data');
    const rename = async () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
    await expect(quarantineFile(file, { dirs: [path.join(tmp, 'q1'), path.join(tmp, 'q2')], rename })).rejects.toMatchObject({ code: 'ENOQUARANTINE' });
    expect(fs.readFileSync(file, 'utf8')).toBe('data');
  });

  it('keeps other records when one manifest line is corrupt', async () => {
    const dir = path.join(tmp, '.dff-quarantine');
    fs.mkdirSync(dir);
    const q1 = path.join(dir, '1_a.jpg');
    fs.writeFileSync(q1, 'x');
    fs.writeFileSync(path.join(dir, 'manifest.jsonl'),
      JSON.stringify({ op: 'quarantine', originalPath: '/o/a.jpg', quarantinePath: q1, deletedAt: '2026-01-01' }) + '\n{"op":"quaran');
    const listed = await listQuarantine([dir]);
    expect(listed).toHaveLength(1);
  });

  it('reads the legacy manifest.json', async () => {
    const dir = path.join(tmp, '.dff-quarantine');
    fs.mkdirSync(dir);
    const q1 = path.join(dir, '1_old.jpg');
    fs.writeFileSync(q1, 'x');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify([{ originalPath: '/o/old.jpg', quarantinePath: q1, deletedAt: '2025-01-01' }]));
    expect(await listQuarantine([dir])).toHaveLength(1);
  });

  it('tries the volume root first, then the scan root, then home', async () => {
    const file = path.join(tmp, 'a.jpg');
    fs.writeFileSync(file, 'data');
    const dirs = await candidateDirs(file, { scanRoot: tmp, homeDir: os.homedir() });
    expect(dirs[0].endsWith('.dff-quarantine')).toBe(true);
    expect(dirs).toContain(path.join(tmp, '.dff-quarantine'));
    expect(dirs[dirs.length - 1]).toBe(path.join(os.homedir(), '.dff-quarantine'));
  });

  it('refuses to restore outside a known quarantine folder', async () => {
    const r = await restoreFile(path.join(tmp, 'elsewhere', 'x'), [path.join(tmp, '.dff-quarantine')]);
    expect(r.success).toBe(false);
  });

  it('refuses to overwrite a file that reappeared at the original path', async () => {
    const scanRoot = path.join(tmp, 'root');
    const file = path.join(scanRoot, 'a.jpg');
    fs.mkdirSync(scanRoot, { recursive: true });
    fs.writeFileSync(file, 'old');
    const { quarantinePath, dir } = await quarantineFile(file, { dirs: [path.join(scanRoot, '.dff-quarantine')] });
    fs.writeFileSync(file, 'new');
    const r = await restoreFile(quarantinePath, [dir]);
    expect(r.success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });
});
