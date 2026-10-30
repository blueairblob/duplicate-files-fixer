// Move to backup — pure planning. No I/O.
//
// The job: a local copy of a device (phone export, SD card, Downloads...) is
// compared, by content, against the WHOLE backup. Files the backup doesn't
// have are copied in; files it already has (anywhere, under any name) are
// skipped. Afterwards the local copies that are verified safe in the backup
// can be cleared to free space.

const path = require('path');

// Split the scan into what to copy and what's already there.
//   newFiles  — local files whose content isn't anywhere in the backup
//   inBackup  — local files with an identical file in the backup (+ that file)
//   unreadable— couldn't be read; never copied, never cleared
// Uses the same labels as the engine: protected = backup, target = local copy.
function buildMovePlan(files, fileMap, unreadable = new Set()) {
  const groupOf = new Map();
  for (const g of fileMap.values()) for (const f of g) groupOf.set(f.path, g);
  const newFiles = [], inBackup = [], unread = [];
  for (const f of files) {
    if (f.sourceLabel !== 'target') continue;
    if (unreadable.has(f.path)) { unread.push(f); continue; }
    const g = groupOf.get(f.path);
    const backupCopy = g && g.find(x => x.sourceLabel === 'protected');
    if (backupCopy) inBackup.push({ file: f, backup: backupCopy.path });
    else newFiles.push(f);
  }
  return { newFiles, inBackup, unreadable: unread };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Where a new file goes in the backup.
 * @param file    { path, root, modified }
 * @param toRoot  the backup folder
 * @param layout  'date'   → <to>/<YYYY>/<MM>/<name>   (by the file's date)
 *                'folders'→ <to>/<source folder name>/<path inside the source>
 */
function destinationFor(file, toRoot, layout, p = path) {
  const name = p.basename(file.path);
  if (layout === 'folders') {
    const root = file.root || p.dirname(file.path);
    const rel = p.relative(root, file.path);
    return p.join(toRoot, p.basename(root) || 'Imported', rel);
  }
  const d = new Date(file.modified);
  const valid = !Number.isNaN(d.getTime());
  return valid
    ? p.join(toRoot, String(d.getFullYear()), pad(d.getMonth() + 1), name)
    : p.join(toRoot, 'Undated', name);
}

// "IMG_1.HEIC" → "IMG_1 (2).HEIC", "(3)"... until `taken(candidate)` is false.
// `taken` may be async (checks the disk) — the result is a promise either way.
async function uniqueName(dest, taken, p = path) {
  if (!(await taken(dest))) return dest;
  const ext = p.extname(dest);
  const stem = dest.slice(0, dest.length - ext.length);
  for (let n = 2; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error('No free file name');
}

module.exports = { buildMovePlan, destinationFor, uniqueName };
