import { describe, it, expect } from 'vitest';
import { sortRows, nextSort } from '../renderer/utils/sortRows.js';

const rows = [
  { name: 'IMG_10.jpg', size: 300, modified: '2024-01-01' },
  { name: 'img_2.jpg', size: 100, modified: '2026-01-01' },
  { name: 'IMG_1.jpg', size: 200, modified: undefined },
];
const names = (r) => r.map(x => x.name);

describe('sortRows', () => {
  it('sorts text naturally and case-insensitively', () => {
    expect(names(sortRows(rows, 'name'))).toEqual(['IMG_1.jpg', 'img_2.jpg', 'IMG_10.jpg']);
    expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['IMG_10.jpg', 'img_2.jpg', 'IMG_1.jpg']);
  });
  it('sorts numbers numerically', () => {
    expect(names(sortRows(rows, 'size', 'desc'))).toEqual(['IMG_10.jpg', 'IMG_1.jpg', 'img_2.jpg']);
  });
  it('puts missing values last in either direction', () => {
    expect(sortRows(rows, 'modified').at(-1).name).toBe('IMG_1.jpg');
    expect(sortRows(rows, 'modified', 'desc').at(-1).name).toBe('IMG_1.jpg');
  });
  it('is stable and does not mutate the input', () => {
    const tie = [{ k: 1, id: 'a' }, { k: 1, id: 'b' }, { k: 0, id: 'c' }];
    expect(sortRows(tie, 'k').map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(tie.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nextSort', () => {
  it('flips direction on the same column, picks a natural start on a new one', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name', false)).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'size', true)).toEqual({ key: 'size', dir: 'desc' });
    expect(nextSort(null, 'name', false)).toEqual({ key: 'name', dir: 'asc' });
  });
});
