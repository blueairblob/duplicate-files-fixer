// Sorting for the Compare lists. Numbers sort numerically, text sorts
// naturally ("IMG_2" before "IMG_10") and case-insensitively; missing values
// always go last. Stable: ties keep their original order.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[key], y = b.row[key];
      const xMissing = x === undefined || x === null || x === '';
      const yMissing = y === undefined || y === null || y === '';
      if (xMissing || yMissing) return xMissing === yMissing ? a.i - b.i : xMissing ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map(({ row }) => row);
}

// Clicking a column: same column flips direction, a new column starts at its
// natural direction (text A→Z, numbers and dates largest/newest first).
export function nextSort(current, key, numeric) {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: numeric ? 'desc' : 'asc' };
}
