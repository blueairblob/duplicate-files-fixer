import { describe, it, expect } from 'vitest';

// ── Pure logic extracted from main.js for testability ────────────────────────

const SUPPORTED_EXTS = new Set([
  '.jpg','.jpeg','.png','.gif','.heic','.raw','.bmp','.webp',
  '.mp3','.aac','.flac','.wav','.ogg','.m4a',
  '.mp4','.mov','.avi','.mkv','.wmv',
  '.pdf','.docx','.xlsx','.pptx','.doc','.xls','.txt',
  '.zip','.rar','.7z','.eml',
]);

const TYPE_MAP = {
  photos:   ['.jpg','.jpeg','.png','.gif','.heic','.raw','.bmp','.webp'],
  audio:    ['.mp3','.aac','.flac','.wav','.ogg','.m4a'],
  video:    ['.mp4','.mov','.avi','.mkv','.wmv'],
  docs:     ['.pdf','.docx','.xlsx','.pptx','.doc','.xls','.txt'],
  archives: ['.zip','.rar','.7z'],
};

function shouldInclude(filePath, filters) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  if (filters.types && filters.types.length > 0) {
    const allowed = filters.types.flatMap(t => TYPE_MAP[t] || []);
    if (!allowed.includes(ext)) return false;
  }
  if (filters.minSize && filters.minSize > 0) {
    if ((filters._size || 0) < filters.minSize) return false;
  }
  return true;
}

function applyAutoMark(files, mode, autoMarkRule) {
  const markedPaths = new Set();
  const hasProtected = files.some(f => f.sourceLabel === 'protected');

  if (mode === 'compare' && hasProtected) {
    files.filter(f => f.sourceLabel === 'target').forEach(f => markedPaths.add(f.path));
  } else {
    let sorted;
    if (autoMarkRule === 'keep-newest' || autoMarkRule === 'protected-wins') {
      sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
    } else if (autoMarkRule === 'keep-oldest') {
      sorted = [...files].sort((a, b) => new Date(a.modified) - new Date(b.modified));
    } else if (autoMarkRule === 'keep-largest') {
      sorted = [...files].sort((a, b) => b.size - a.size);
    } else {
      sorted = [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified));
    }
    sorted.slice(1).forEach(f => markedPaths.add(f.path));
  }
  return markedPaths;
}

// ── File inclusion tests ──────────────────────────────────────────────────────
describe('shouldInclude', () => {
  it('accepts supported image extension', () => {
    expect(shouldInclude('photo.jpg', {})).toBe(true);
  });
  it('rejects unsupported extension', () => {
    expect(shouldInclude('script.exe', {})).toBe(false);
    expect(shouldInclude('file.dll', {})).toBe(false);
  });
  it('respects type filter — photos only', () => {
    expect(shouldInclude('song.mp3',   { types: ['photos'] })).toBe(false);
    expect(shouldInclude('photo.jpg',  { types: ['photos'] })).toBe(true);
    expect(shouldInclude('video.mp4',  { types: ['photos'] })).toBe(false);
  });
  it('accepts all types when filter is empty', () => {
    expect(shouldInclude('doc.pdf',    { types: [] })).toBe(true);
    expect(shouldInclude('archive.zip',{ types: [] })).toBe(true);
  });
  it('respects minSize filter', () => {
    expect(shouldInclude('file.pdf', { minSize: 1000000, _size: 500 })).toBe(false);
    expect(shouldInclude('file.pdf', { minSize: 1000000, _size: 2000000 })).toBe(true);
  });
  it('handles uppercase extensions', () => {
    expect(shouldInclude('PHOTO.JPG', {})).toBe(true);
    expect(shouldInclude('VIDEO.MP4', {})).toBe(true);
  });
  it('handles dotfiles gracefully', () => {
    expect(shouldInclude('.hidden', {})).toBe(false);
  });
});

// ── Auto-mark logic tests ─────────────────────────────────────────────────────
describe('applyAutoMark — compare mode, protected-wins', () => {
  const files = [
    { path: '/backup/file.jpg',    sourceLabel: 'protected', size: 1000, modified: '2024-01-01T00:00:00Z' },
    { path: '/downloads/file.jpg', sourceLabel: 'target',    size: 1000, modified: '2024-02-01T00:00:00Z' },
    { path: '/desktop/file.jpg',   sourceLabel: 'target',    size: 1000, modified: '2024-03-01T00:00:00Z' },
  ];

  it('marks all target files when protected copy exists', () => {
    const marked = applyAutoMark(files, 'compare', 'protected-wins');
    expect(marked.has('/backup/file.jpg')).toBe(false);
    expect(marked.has('/downloads/file.jpg')).toBe(true);
    expect(marked.has('/desktop/file.jpg')).toBe(true);
  });

  it('never marks protected files', () => {
    const marked = applyAutoMark(files, 'compare', 'protected-wins');
    const protectedFiles = files.filter(f => f.sourceLabel === 'protected');
    protectedFiles.forEach(f => {
      expect(marked.has(f.path)).toBe(false);
    });
  });
});

describe('applyAutoMark — keep-newest rule', () => {
  const files = [
    { path: '/a/old.jpg',    sourceLabel: 'target', size: 1000, modified: '2023-01-01T00:00:00Z' },
    { path: '/b/newer.jpg',  sourceLabel: 'target', size: 1000, modified: '2024-01-01T00:00:00Z' },
    { path: '/c/newest.jpg', sourceLabel: 'target', size: 1000, modified: '2025-01-01T00:00:00Z' },
  ];

  it('keeps newest, marks older copies', () => {
    const marked = applyAutoMark(files, 'simple', 'keep-newest');
    expect(marked.has('/c/newest.jpg')).toBe(false);
    expect(marked.has('/b/newer.jpg')).toBe(true);
    expect(marked.has('/a/old.jpg')).toBe(true);
  });

  it('marks exactly n-1 files from a group of n', () => {
    const marked = applyAutoMark(files, 'simple', 'keep-newest');
    expect(marked.size).toBe(2);
  });
});

describe('applyAutoMark — keep-oldest rule', () => {
  const files = [
    { path: '/a/old.jpg',    sourceLabel: 'target', size: 1000, modified: '2023-01-01T00:00:00Z' },
    { path: '/b/newer.jpg',  sourceLabel: 'target', size: 1000, modified: '2024-01-01T00:00:00Z' },
    { path: '/c/newest.jpg', sourceLabel: 'target', size: 1000, modified: '2025-01-01T00:00:00Z' },
  ];

  it('keeps oldest, marks newer copies', () => {
    const marked = applyAutoMark(files, 'simple', 'keep-oldest');
    expect(marked.has('/a/old.jpg')).toBe(false);
    expect(marked.has('/b/newer.jpg')).toBe(true);
    expect(marked.has('/c/newest.jpg')).toBe(true);
  });
});

describe('applyAutoMark — keep-largest rule', () => {
  const files = [
    { path: '/a/small.jpg',  sourceLabel: 'target', size: 100,  modified: '2024-01-01T00:00:00Z' },
    { path: '/b/medium.jpg', sourceLabel: 'target', size: 500,  modified: '2024-01-01T00:00:00Z' },
    { path: '/c/large.jpg',  sourceLabel: 'target', size: 5000, modified: '2024-01-01T00:00:00Z' },
  ];

  it('keeps largest, marks smaller copies', () => {
    const marked = applyAutoMark(files, 'simple', 'keep-largest');
    expect(marked.has('/c/large.jpg')).toBe(false);
    expect(marked.has('/b/medium.jpg')).toBe(true);
    expect(marked.has('/a/small.jpg')).toBe(true);
  });
});

describe('applyAutoMark — edge cases', () => {
  it('handles a group of exactly two files', () => {
    const files = [
      { path: '/a/file.pdf', sourceLabel: 'target', size: 1000, modified: '2025-01-01T00:00:00Z' },
      { path: '/b/file.pdf', sourceLabel: 'target', size: 1000, modified: '2024-01-01T00:00:00Z' },
    ];
    const marked = applyAutoMark(files, 'simple', 'keep-newest');
    expect(marked.size).toBe(1);
    expect(marked.has('/b/file.pdf')).toBe(true);
  });

  it('handles all files in protected source — marks none', () => {
    const files = [
      { path: '/backup/a.jpg', sourceLabel: 'protected', size: 1000, modified: '2024-01-01T00:00:00Z' },
      { path: '/backup/b.jpg', sourceLabel: 'protected', size: 1000, modified: '2023-01-01T00:00:00Z' },
    ];
    const marked = applyAutoMark(files, 'compare', 'protected-wins');
    // No target files, so nothing to mark
    expect(marked.size).toBe(0);
  });
});
