import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { buildMovePlan, destinationFor, uniqueName } from '../main/movePlan.js';
import { executeCopy } from '../main/copyFiles.js';

const f = (p, label, over = {}) => ({ path: p, sourceLabel: label, size: 10, modified: '2025-07-14T10:00:00.000Z', root: label === 'target' ? '/phone' : '/nas', ...over });

describe('buildMovePlan', () => {
  it('splits the local copy into new / already in backup / unreadable', () => {
    const a = f('/phone/a.jpg', 'target'), aBackup = f('/nas/2025/a.jpg', 'protected');
    const again = f('/phone/a (1).jpg', 'target');          // a re-import of the same photo
    const b = f('/phone/b.jpg', 'target');
    const locked = f('/phone/locked.jpg', 'target');
    const plan = buildMovePlan([a, aBackup, again, b, locked], new Map([['h', [a, aBackup, again]]]), new Set(['/phone/locked.jpg']));
    expect(plan.newFiles.map(x => x.path)).toEqual(['/phone/b.jpg']);
    expect(plan.inBackup.map(x => [x.file.path, x.backup])).toEqual([['/phone/a.jpg', '/nas/2025/a.jpg'], ['/phone/a (1).jpg', '/nas/2025/a.jpg']]);
    expect(plan.unreadable.map(x => x.path)).toEqual(['/phone/locked.jpg']);
  });
});

describe('destinationFor', () => {
  it('files by year/month of the file date by default', () => {
    const d = destinationFor(f('/phone/DCIM/100APPLE/IMG_1.HEIC', 'target'), '/nas/Photos', 'date', path.posix);
    expect(d).toMatch(/^\/nas\/Photos\/2025\/07\/IMG_1\.HEIC$/);
  });
  it('keeps the source folder layout when asked', () => {
    const d = destinationFor(f('/phone/DCIM/100APPLE/IMG_1.HEIC', 'target'), '/nas/Photos', 'folders', path.posix);
    expect(d).toBe('/nas/Photos/phone/DCIM/100APPLE/IMG_1.HEIC');
  });
  it('puts files without a usable date in Undated', () => {
    expect(destinationFor(f('/phone/x.jpg', 'target', { modified: 'nope' }), '/nas', 'date', path.posix)).toBe('/nas/Undated/x.jpg');
  });
});

describe('uniqueName', () => {
  it('adds (2), (3)… before the extension', async () => {
    const taken = new Set(['/n/a.jpg', '/n/a (2).jpg']);
    expect(await uniqueName('/n/a.jpg', async (p) => taken.has(p), path.posix)).toBe('/n/a (3).jpg');
    expect(await uniqueName('/n/b.jpg', async (p) => taken.has(p), path.posix)).toBe('/n/b.jpg');
  });
});

// ── executeCopy on real temp folders ─────────────────────────────────────────

let tmp, phone, nas;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realDeps = (over = {}) => ({
  exists: async (p) => fs.existsSync(p),
  mkdir: async (d) => fs.promises.mkdir(d, { recursive: true }),
  copyFile: (a, b) => fs.promises.copyFile(a, b),
  hash: async (p) => sha(p),
  rename: (a, b) => fs.promises.rename(a, b),
  remove: (p) => fs.promises.rm(p, { force: true }),
  setTimes: (p, iso) => fs.promises.utimes(p, new Date(iso), new Date(iso)),
  ...over,
});
const put = (p, body, iso = '2025-07-14T10:00:00.000Z') => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, new Date(iso), new Date(iso));
  return { path: p, root: phone, size: Buffer.byteLength(body), modified: new Date(iso).toISOString(), sourceLabel: 'target' };
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-move-'));
  phone = path.join(tmp, 'phone');
  nas = path.join(tmp, 'nas');
  fs.mkdirSync(nas, { recursive: true });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('executeCopy', () => {
  it('copies into Year/Month, verifies, keeps the date, never touches the source', async () => {
    const a = put(path.join(phone, 'DCIM', 'IMG_1.HEIC'), 'photo one');
    const r = await executeCopy([a], { toRoot: nas, layout: 'date' }, realDeps());
    const dest = path.join(nas, '2025', '07', 'IMG_1.HEIC');
    expect(r.copied).toEqual([expect.objectContaining({ local: a.path, backup: dest })]);
    expect(fs.readFileSync(dest, 'utf8')).toBe('photo one');
    expect(fs.statSync(dest).mtime.toISOString()).toBe(a.modified);
    expect(fs.existsSync(a.path)).toBe(true);
    expect(fs.readdirSync(path.dirname(dest)).some(n => n.endsWith('.holdfast-partial'))).toBe(false);
  });

  it('never overwrites: an identical file is skipped, a different one gets (2)', async () => {
    const same = put(path.join(phone, 'same.jpg'), 'S');
    const clash = put(path.join(phone, 'clash.jpg'), 'NEW');
    fs.mkdirSync(path.join(nas, '2025', '07'), { recursive: true });
    fs.writeFileSync(path.join(nas, '2025', '07', 'same.jpg'), 'S');
    fs.writeFileSync(path.join(nas, '2025', '07', 'clash.jpg'), 'OLD');
    const r = await executeCopy([same, clash], { toRoot: nas, layout: 'date' }, realDeps());
    expect(r.skipped.map(x => x.path)).toEqual([same.path]);
    expect(r.copied.map(x => path.basename(x.backup))).toEqual(['clash (2).jpg']);
    expect(fs.readFileSync(path.join(nas, '2025', '07', 'clash.jpg'), 'utf8')).toBe('OLD');
  });

  it('two new files wanting the same name both land, one as (2)', async () => {
    const x = put(path.join(phone, 'a', 'IMG.jpg'), 'one');
    const y = put(path.join(phone, 'b', 'IMG.jpg'), 'two');
    const r = await executeCopy([x, y], { toRoot: nas, layout: 'date' }, realDeps());
    expect(r.copied.map(c => path.basename(c.backup)).sort()).toEqual(['IMG (2).jpg', 'IMG.jpg']);
  });

  it('a copy that does not match is removed and reported, never renamed into place', async () => {
    const a = put(path.join(phone, 'bad.jpg'), 'original');
    const r = await executeCopy([a], { toRoot: nas, layout: 'date' }, realDeps({
      copyFile: async (src, dest) => fs.promises.writeFile(dest, 'corrupted'),
    }));
    expect(r.failed[0].error).toMatch(/does not match/);
    expect(fs.existsSync(path.join(nas, '2025', '07', 'bad.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(nas, '2025', '07', 'bad.jpg.holdfast-partial'))).toBe(false);
  });

  it('stops when cancelled', async () => {
    const files = [0, 1, 2, 3].map(i => put(path.join(phone, `${i}.jpg`), `f${i}`));
    let n = 0;
    const r = await executeCopy(files, { toRoot: nas, layout: 'date' }, realDeps({
      concurrency: 1, isCancelled: () => n >= 2, onProgress: () => { n++; },
    }));
    expect(r.copied).toHaveLength(2);
    expect(r.skipped.filter(s => /Cancelled/.test(s.reason))).toHaveLength(2);
    expect(r.cancelled).toBe(true);
  });
});

import { previewDestination } from '../renderer/utils/movePreview.js';

describe('previewDestination matches the real destination', () => {
  const cases = [
    { file: { path: 'C:\\Phone\\DCIM\\100APPLE\\IMG_1.HEIC', root: 'C:\\Phone', modified: '2025-07-14T10:00:00.000Z' }, to: 'Z:\\Photos', p: path.win32 },
    { file: { path: '/home/u/phone/DCIM/a.jpg', root: '/home/u/phone', modified: '2024-01-02T10:00:00.000Z' }, to: '/mnt/nas/Photos', p: path.posix },
    { file: { path: '/home/u/phone/x.jpg', root: '/home/u/phone', modified: 'bad' }, to: '/mnt/nas', p: path.posix },
  ];
  for (const layout of ['date', 'folders']) {
    for (const c of cases) {
      it(`${layout}: ${c.file.path}`, () => {
        expect(previewDestination(c.file, c.to, layout)).toBe(destinationFor(c.file, c.to, layout, c.p));
      });
    }
  }
});
