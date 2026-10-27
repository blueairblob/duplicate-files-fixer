import { describe, it, expect } from 'vitest';
import {
  shouldIncludeFile, sizeCandidates, sortForKeep, buildGroups,
  buildCensus, censusProblems, buildVerifyReport,
} from '../main/scanCore.js';

// Tests the real scan logic (src/main/scanCore.js) used by the worker.

const file = (p, over = {}) => ({
  path: p, name: p.split('/').pop(), size: 100, modified: '2026-01-01T00:00:00.000Z',
  ext: '.' + p.split('.').pop(), sourceLabel: 'target', root: '/t', ...over,
});
const src = (p, over) => file(p, { sourceLabel: 'protected', root: '/s', ...over });
// fileMap: content key -> files sharing that content
const mapOf = (...groups) => new Map(groups.map((g, i) => [`h${i}`, g]));

describe('shouldIncludeFile', () => {
  it('includes every file when no types are picked — RAW, TIFF, unknown, no extension', () => {
    for (const p of ['a.cr2', 'a.NEF', 'a.dng', 'a.tif', 'a.m4v', 'a.xyz', 'Makefile', '.hidden']) {
      expect(shouldIncludeFile(p, {})).toBe(true);
      expect(shouldIncludeFile(p, { types: [] })).toBe(true);
    }
  });
  it('restricts to the picked types, case-insensitively', () => {
    expect(shouldIncludeFile('IMG.CR2', { types: ['photos'] })).toBe(true);
    expect(shouldIncludeFile('a.mp3', { types: ['photos'] })).toBe(false);
    expect(shouldIncludeFile('a.mp3', { types: ['photos', 'audio'] })).toBe(true);
    expect(shouldIncludeFile('notes', { types: ['docs'] })).toBe(false);
  });
});

describe('sizeCandidates', () => {
  it('drops files with a unique size', () => {
    const c = sizeCandidates([file('/t/a', { size: 1 }), file('/t/b', { size: 2 }), file('/t/c', { size: 2 })]);
    expect(c.map(f => f.path)).toEqual(['/t/b', '/t/c']);
  });
  it('keeps every member of a 3+ group and handles several groups', () => {
    const c = sizeCandidates([
      file('/t/a', { size: 5 }), file('/t/b', { size: 5 }), file('/t/c', { size: 5 }),
      file('/t/d', { size: 9 }), file('/t/e', { size: 9 }), file('/t/f', { size: 7 }),
    ]);
    expect(c.map(f => f.path)).toEqual(['/t/a', '/t/b', '/t/c', '/t/d', '/t/e']);
  });
  it('dedupes by path and sorts by path', () => {
    const c = sizeCandidates([file('/t/z', { size: 3 }), file('/t/a', { size: 3 }), file('/t/z', { size: 3 })]);
    expect(c.map(f => f.path)).toEqual(['/t/a', '/t/z']);
  });
  it('returns nothing when every size is unique', () => {
    expect(sizeCandidates([file('/t/a', { size: 1 }), file('/t/b', { size: 2 })])).toEqual([]);
  });
});

describe('sortForKeep / buildGroups', () => {
  const older = file('/t/old.jpg', { modified: '2020-01-01T00:00:00.000Z', size: 100 });
  const newer = file('/t/new.jpg', { modified: '2024-01-01T00:00:00.000Z', size: 100 });
  const bigger = file('/t/big.jpg', { modified: '2022-01-01T00:00:00.000Z', size: 200 });

  it('keep-newest (default) keeps the newest copy', () => {
    expect(sortForKeep([older, newer], 'keep-newest')[0]).toBe(newer);
    expect(sortForKeep([older, newer], undefined)[0]).toBe(newer);
  });
  it('keep-oldest keeps the oldest copy', () => {
    expect(sortForKeep([newer, older], 'keep-oldest')[0]).toBe(older);
  });
  it('keep-largest keeps the largest copy', () => {
    expect(sortForKeep([older, bigger], 'keep-largest')[0]).toBe(bigger);
  });

  it('simple mode marks n-1 copies per group and skips singletons', () => {
    const groups = buildGroups(mapOf([older, newer, file('/t/x.jpg', { modified: '2019-01-01T00:00:00.000Z' })], [file('/t/solo')]), 'simple', 'keep-newest');
    expect(groups).toHaveLength(1);
    expect(groups[0].autoMarked).toHaveLength(2);
    expect(groups[0].autoMarked).not.toContain(newer.path);
  });

  it('compare mode marks every target copy when a protected copy exists, never the protected one', () => {
    const p = src('/s/a.jpg');
    const groups = buildGroups(mapOf([p, file('/t/a1.jpg'), file('/t/a2.jpg')]), 'compare', 'keep-newest');
    expect(groups[0].autoMarked.sort()).toEqual(['/t/a1.jpg', '/t/a2.jpg']);
    expect(groups[0].hasProtected).toBe(true);
  });

  it('compare mode ignores groups that live only in the source', () => {
    expect(buildGroups(mapOf([src('/s/a'), src('/s/b')]), 'compare', 'keep-newest')).toEqual([]);
  });
});

describe('buildCensus', () => {
  it('counts in-both, source-only and target-only, and reconciles', () => {
    const s1 = src('/s/a.jpg'), s2 = src('/s/b.jpg');
    const t1 = file('/t/a.jpg'), t2 = file('/t/a copy.jpg'), t3 = file('/t/new.jpg');
    const c = buildCensus([s1, s2, t1, t2, t3], mapOf([s1, t1, t2]), ['/s'], ['/t']);
    expect(c.matched.targetFiles).toBe(2);
    expect(c.matched.sourceFiles).toBe(1);  // one source file covers two target copies
    expect(c.sourceOnly.files).toBe(1);
    expect(c.targetOnly.files).toBe(1);
    expect(censusProblems(c)).toEqual([]);
  });

  it('puts unreadable files in their own bucket, not "only in target"', () => {
    const s1 = src('/s/a.jpg'), t1 = file('/t/a.jpg'), t2 = file('/t/locked.jpg');
    const c = buildCensus([s1, t1, t2], mapOf([s1, t1]), ['/s'], ['/t'], new Set(['/t/locked.jpg']));
    expect(c.targetOnly.files).toBe(0);
    expect(c.unreadable.targetFiles).toBe(1);
    expect(c.folders[0].state).toBe('partial'); // can't call it fully backed up
    expect(censusProblems(c)).toEqual([]);
  });

  it('keeps same-named folders under different target roots apart', () => {
    const s1 = src('/s/a.jpg');
    const ta = file('/A/Photos/a.jpg', { root: '/A' });
    const tb = file('/B/Photos/b.jpg', { root: '/B' });
    const c = buildCensus([s1, ta, tb], mapOf([s1, ta]), ['/s'], ['/A', '/B']);
    expect(c.folders).toHaveLength(2);
    expect(new Set(c.folders.map(f => f.key)).size).toBe(2);
    expect(c.folders.find(f => f.root === '/A').state).toBe('all');
    expect(c.folders.find(f => f.root === '/B').state).toBe('none');
  });
});

describe('buildVerifyReport — is every SOURCE file in the BACKUP?', () => {
  it('reports source files missing from the backup as the risk', () => {
    const s1 = src('/s/kept.jpg'), s2 = src('/s/lost.jpg');
    const b1 = file('/b/kept.jpg', { root: '/b' }), b2 = file('/b/extra.jpg', { root: '/b' });
    const r = buildVerifyReport([s1, s2, b1, b2], mapOf([s1, b1]));
    expect(r.missing.map(f => f.path)).toEqual(['/s/lost.jpg']);
    expect(r.backedUp.map(m => [m.source.path, m.backup.path])).toEqual([['/s/kept.jpg', '/b/kept.jpg']]);
    expect(r.backupOnly.map(f => f.path)).toEqual(['/b/extra.jpg']);
    expect(r.summary.missingCount).toBe(1);
  });

  it('does not report "all backed up" when the backup holds only a subset', () => {
    const sources = Array.from({ length: 5 }, (_, i) => src(`/s/${i}.jpg`));
    const backup = file('/b/0.jpg', { root: '/b' });
    const r = buildVerifyReport([...sources, backup], mapOf([sources[0], backup]));
    expect(r.summary.missingCount).toBe(4);
  });

  it('lists unreadable files separately rather than as missing', () => {
    const s1 = src('/s/locked.jpg');
    const r = buildVerifyReport([s1], new Map(), new Set(['/s/locked.jpg']));
    expect(r.missing).toEqual([]);
    expect(r.summary.unreadableSourceCount).toBe(1);
  });
});
