// Where a file will land in the backup — the renderer's copy of
// src/main/movePlan.js destinationFor(), for previews only (the main process
// decides the real path). moveToBackup.test.js checks the two agree.

const pad = (n) => String(n).padStart(2, '0');

export function previewDestination(file, toRoot, layout) {
  const sep = /\\/.test(toRoot) || /^[A-Za-z]:/.test(toRoot) ? '\\' : '/';
  const parts = (p) => p.split(/[\\/]+/).filter(Boolean);
  const base = toRoot.replace(/[\\/]+$/, '');
  const name = parts(file.path).pop() || file.path;
  if (layout === 'folders') {
    const rootParts = parts(file.root || '');
    const fileParts = parts(file.path);
    const rel = fileParts.slice(rootParts.length);
    const rootName = rootParts[rootParts.length - 1] || 'Imported';
    return [base, rootName, ...rel].join(sep);
  }
  const d = new Date(file.modified);
  if (Number.isNaN(d.getTime())) return [base, 'Undated', name].join(sep);
  return [base, String(d.getFullYear()), pad(d.getMonth() + 1), name].join(sep);
}
