import { describe, it, expect } from 'vitest';

// Pure re-implementation of the size-grouping logic from scanWorker.js,
// extracted here for fast, dependency-free testing (no real file I/O or hashing).

function groupBySize(files) {
  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }
  return bySize;
}

function candidatesForHashing(files) {
  const bySize = groupBySize(files);
  const candidates = [];
  for (const group of bySize.values()) {
    if (group.length > 1) candidates.push(...group);
  }
  return candidates;
}

function separateEmptyFiles(files) {
  return {
    empty: files.filter(f => f.size === 0),
    nonEmpty: files.filter(f => f.size !== 0),
  };
}

describe('groupBySize', () => {
  it('groups files sharing the same size together', () => {
    const files = [
      { path: 'a.jpg', size: 1000 },
      { path: 'b.jpg', size: 1000 },
      { path: 'c.jpg', size: 2000 },
    ];
    const groups = groupBySize(files);
    expect(groups.get(1000).length).toBe(2);
    expect(groups.get(2000).length).toBe(1);
  });
});

describe('candidatesForHashing — the core two-pass optimisation', () => {
  it('excludes files with a unique size from hashing entirely', () => {
    const files = [
      { path: 'unique1.jpg', size: 500 },
      { path: 'unique2.jpg', size: 999 },
      { path: 'dup-a.jpg',   size: 1000 },
      { path: 'dup-b.jpg',   size: 1000 },
    ];
    const candidates = candidatesForHashing(files);
    expect(candidates.length).toBe(2);
    expect(candidates.map(f => f.path).sort()).toEqual(['dup-a.jpg', 'dup-b.jpg']);
  });

  it('returns an empty list when every file has a unique size', () => {
    const files = [
      { path: 'a.jpg', size: 100 },
      { path: 'b.jpg', size: 200 },
      { path: 'c.jpg', size: 300 },
    ];
    expect(candidatesForHashing(files)).toEqual([]);
  });

  it('includes all files from a size group of 3+', () => {
    const files = [
      { path: 'a.jpg', size: 1000 },
      { path: 'b.jpg', size: 1000 },
      { path: 'c.jpg', size: 1000 },
    ];
    expect(candidatesForHashing(files).length).toBe(3);
  });

  it('handles multiple independent duplicate-size groups', () => {
    const files = [
      { path: 'a1.jpg', size: 1000 },
      { path: 'a2.jpg', size: 1000 },
      { path: 'b1.jpg', size: 2000 },
      { path: 'b2.jpg', size: 2000 },
      { path: 'unique.jpg', size: 3000 },
    ];
    const candidates = candidatesForHashing(files);
    expect(candidates.length).toBe(4);
  });

  it('dramatically reduces hash workload on a realistic file set', () => {
    // Simulate 1000 files, only 20 of which share sizes with another file
    const files = [];
    for (let i = 0; i < 980; i++) files.push({ path: `unique_${i}.dat`, size: 10000 + i });
    for (let i = 0; i < 10; i++) {
      files.push({ path: `dup_${i}_a.dat`, size: 99999 });
      files.push({ path: `dup_${i}_b.dat`, size: 99999 });
    }
    // NOTE: all 10 "duplicate" pairs share the SAME size (99999) in this synthetic case,
    // which collapses them into one group of 20 — still proves the filtering principle.
    const candidates = candidatesForHashing(files);
    expect(candidates.length).toBe(20);
    expect(candidates.length).toBeLessThan(files.length);
  });
});

describe('separateEmptyFiles', () => {
  it('separates zero-byte files from content-bearing files', () => {
    const files = [
      { path: 'empty1.txt', size: 0 },
      { path: 'empty2.txt', size: 0 },
      { path: 'real.txt',   size: 500 },
    ];
    const { empty, nonEmpty } = separateEmptyFiles(files);
    expect(empty.length).toBe(2);
    expect(nonEmpty.length).toBe(1);
  });

  it('returns empty arrays when there are no zero-byte files', () => {
    const files = [{ path: 'a.txt', size: 10 }];
    const { empty, nonEmpty } = separateEmptyFiles(files);
    expect(empty).toEqual([]);
    expect(nonEmpty.length).toBe(1);
  });
});

// ── Tests for the boundary-hash pass (Pass 2 → Pass 3 filter) ────────────────

function candidatesForFullHash(filesWithBoundaryHash) {
  const byBoundary = new Map();
  for (const f of filesWithBoundaryHash) {
    if (!byBoundary.has(f.boundaryHash)) byBoundary.set(f.boundaryHash, []);
    byBoundary.get(f.boundaryHash).push(f);
  }
  const candidates = [];
  for (const group of byBoundary.values()) {
    if (group.length >= 2) candidates.push(...group);
  }
  return candidates;
}

describe('candidatesForFullHash — boundary hash reduces full-hash workload', () => {
  it('excludes files whose boundary hash is unique from full hashing', () => {
    const files = [
      { path: 'a.jpg', boundaryHash: 'B:aaa' },
      { path: 'b.jpg', boundaryHash: 'B:bbb' },
      { path: 'c.jpg', boundaryHash: 'B:aaa' },
    ];
    const candidates = candidatesForFullHash(files);
    expect(candidates.map(f => f.path).sort()).toEqual(['a.jpg', 'c.jpg']);
  });

  it('returns empty list when all boundary hashes are unique', () => {
    const files = [
      { path: 'x.jpg', boundaryHash: 'B:x' },
      { path: 'y.jpg', boundaryHash: 'B:y' },
    ];
    expect(candidatesForFullHash(files)).toEqual([]);
  });

  it('passes all files through when all share a boundary hash', () => {
    const files = [
      { path: 'a.jpg', boundaryHash: 'B:same' },
      { path: 'b.jpg', boundaryHash: 'B:same' },
      { path: 'c.jpg', boundaryHash: 'B:same' },
    ];
    expect(candidatesForFullHash(files).length).toBe(3);
  });

  it('handles multiple boundary-hash groups independently', () => {
    const files = [
      { path: 'a1.jpg', boundaryHash: 'B:g1' },
      { path: 'a2.jpg', boundaryHash: 'B:g1' },
      { path: 'b1.jpg', boundaryHash: 'B:g2' },
      { path: 'b2.jpg', boundaryHash: 'B:g2' },
      { path: 'solo.jpg', boundaryHash: 'B:solo' },
    ];
    const candidates = candidatesForFullHash(files);
    expect(candidates.length).toBe(4);
    expect(candidates.map(f => f.path)).not.toContain('solo.jpg');
  });

  it('dramatically reduces full-hash work for a near-duplicate-free library', () => {
    const files = Array.from({ length: 1000 }, (_, i) => ({
      path: `file_${i}.jpg`,
      boundaryHash: `B:unique_${i}`,
    }));
    // Inject 4 true duplicates
    files[0].boundaryHash = 'B:dup';
    files[1].boundaryHash = 'B:dup';
    files[2].boundaryHash = 'B:dup2';
    files[3].boundaryHash = 'B:dup2';
    const candidates = candidatesForFullHash(files);
    expect(candidates.length).toBe(4);
    expect(candidates.length).toBeLessThan(files.length * 0.01);
  });
});
