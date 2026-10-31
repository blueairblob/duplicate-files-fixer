// Move to backup — the copy step. Side effects come in through `deps`
// (real fs in the app, temp folders in tests).
//
// Per file:
//   1. Work out where it goes (movePlan.destinationFor).
//   2. If something already sits at that name: identical → skip it (already
//      backed up); different → pick "name (2).ext". Never overwrite.
//   3. Copy to "<dest>.holdfast-partial", hash the copy and the original, and
//      only if they match rename it into place and give it the original's
//      date. A mismatch removes the partial file and reports a failure.
// Nothing at the source is changed here.

const path = require('path');
const { destinationFor, uniqueName } = require('./movePlan');

const PARTIAL = '.holdfast-partial';

/**
 * @param files  movePlan newFiles: [{ path, root, size, modified }]
 * @param opts   { toRoot, layout }
 * @param deps   { exists(p), mkdir(dir), copyFile(src, dest), hash(p), rename(a, b),
 *                 remove(p), setTimes(p, modifiedIso), isCancelled?(), onProgress?(), concurrency? }
 */
async function executeCopy(files, { toRoot, layout }, deps) {
  const results = { copied: [], skipped: [], failed: [], bytes: 0, cancelled: false };
  const cancelled = () => !!(deps.isCancelled && deps.isCancelled());
  const claimed = new Set(); // destinations taken by this run (two files can want one name)
  let done = 0;

  // Choosing a name and claiming it happens one file at a time.
  let lock = Promise.resolve();
  const serial = (fn) => { const run = lock.then(fn); lock = run.catch(() => {}); return run; };

  async function one(file) {
    if (cancelled()) { results.skipped.push({ path: file.path, reason: 'Cancelled — not copied' }); return; }
    const wanted = destinationFor(file, toRoot, layout);

    // Already backed up at exactly this name?
    let srcHash = null;
    if (await deps.exists(wanted) && !claimed.has(wanted)) {
      try {
        srcHash = await deps.hash(file.path);
        if ((await deps.hash(wanted)) === srcHash) {
          results.skipped.push({ path: file.path, reason: 'Already in the backup under the same name', backup: wanted });
          return;
        }
      } catch (e) {
        results.failed.push({ path: file.path, error: `Could not compare with ${wanted}: ${e.message}` });
        return;
      }
    }

    const dest = await serial(async () => {
      const d = await uniqueName(wanted, async (c) => claimed.has(c) || (await deps.exists(c)));
      claimed.add(d);
      return d;
    });
    const partial = dest + PARTIAL;
    try {
      await deps.mkdir(path.dirname(dest));
      await deps.copyFile(file.path, partial);
      const [a, b] = await Promise.all([srcHash || deps.hash(file.path), deps.hash(partial)]);
      if (a !== b) throw new Error('The copy does not match the original');
      if (await deps.exists(dest)) throw new Error(`${dest} appeared during the copy`);
      await deps.rename(partial, dest);
      try { await deps.setTimes(dest, file.modified); } catch { /* the date is nice-to-have */ }
      results.copied.push({ local: file.path, backup: dest, size: file.size, hash: a });
      results.bytes += file.size || 0;
    } catch (e) {
      try { await deps.remove(partial); } catch { /* nothing written */ }
      results.failed.push({ path: file.path, error: e.message });
    }
  }

  let next = 0;
  const width = Math.max(1, Math.min(deps.concurrency || 2, files.length));
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < files.length) {
      const f = files[next++];
      await one(f);
      done++;
      deps.onProgress && deps.onProgress({ done, total: files.length, path: f.path, bytes: results.bytes });
    }
  }));
  results.cancelled = cancelled();
  return results;
}

module.exports = { executeCopy, PARTIAL };
