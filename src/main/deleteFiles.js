// Delete executor — runs a plan from deleteGuard.planDeletion.
//
// No Electron imports: every side effect comes in through `deps`, so the whole
// safety chain is testable against temp folders.
//
// Per file, in order:
//   1. The file still matches the scan (exists, same size, mtime, identity).
//   2. The kept copy still exists, is the same size, and is a DIFFERENT
//      physical file (one file reached by two paths is not a duplicate).
//   3. Content check: a full-hash compare when the scan was below Thorough, or
//      when the kept copy changed since the scan.
//   4. Route: Recycle Bin (local paths only) -> same-volume quarantine ->
//      otherwise NOT deleted. Nothing is ever permanently deleted.

/**
 * @param {Array} items   planDeletion(...).items
 * @param {object} deps
 *   stat(p)            -> Promise<{ size:number, modified:string, id:string|null }>
 *   hash(p)            -> Promise<string>
 *   trash(p)           -> Promise<void>   (OS Recycle Bin)
 *   quarantine(p, file)-> Promise<{ quarantinePath }>
 *   isNetworkPath(p)   -> boolean         (skip the Recycle Bin)
 *   verifyContent      boolean
 *   onProgress?({ done, total, path })
 */
async function executeDeletion(items, deps) {
  const results = { trashed: [], quarantined: [], skipped: [], failed: [], freedBytes: 0 };
  const skip = (path, reason) => results.skipped.push({ path, reason });
  let done = 0;

  for (const item of items) {
    const { path, file, counterpart, counterpartFile } = item;
    deps.onProgress && deps.onProgress({ done, total: items.length, path });
    done++;

    // 1. Unchanged since the scan?
    let s;
    try { s = await deps.stat(path); } catch { skip(path, 'File no longer exists'); continue; }
    if (s.size !== file.size || s.modified !== file.modified || (file.id && s.id && s.id !== file.id)) {
      skip(path, 'File changed since the scan — not deleted');
      continue;
    }

    // 2–3. Kept copy still there, distinct, and matching?
    if (counterpart) {
      let c;
      try { c = await deps.stat(counterpart); } catch { skip(path, 'The kept copy is missing — not deleted'); continue; }
      if (c.size !== s.size) { skip(path, 'The kept copy no longer matches — not deleted'); continue; }
      if (c.id && s.id && c.id === s.id) { skip(path, 'Same physical file as the kept copy — not deleted'); continue; }

      const keptChanged = !counterpartFile || c.modified !== counterpartFile.modified;
      if (deps.verifyContent || keptChanged) {
        try {
          const [a, b] = await Promise.all([deps.hash(path), deps.hash(counterpart)]);
          if (a !== b) { skip(path, 'Contents no longer match the kept copy — not deleted'); continue; }
        } catch (e) {
          skip(path, `Could not verify: ${e.message}`);
          continue;
        }
      }
    }

    // 4. Recoverable routes only.
    if (!deps.isNetworkPath(path)) {
      try {
        await deps.trash(path);
        results.trashed.push(path);
        results.freedBytes += s.size;
        continue;
      } catch { /* fall through to quarantine */ }
    }
    try {
      await deps.quarantine(path, file);
      results.quarantined.push(path);
      results.freedBytes += s.size;
    } catch (e) {
      results.failed.push({ path, error: e.message || 'No recoverable location — not deleted' });
    }
  }

  deps.onProgress && deps.onProgress({ done, total: items.length, path: null });
  return results;
}

// Windows network paths: UNC, or a drive letter mapped to a share. The
// Recycle Bin doesn't cover these, so they go straight to quarantine.
function makeIsNetworkPath(platform, mappings) {
  const letters = new Set((mappings || []).map(m => String(m.local || '').toUpperCase()));
  return (p) => {
    if (platform !== 'win32') return false;
    if (/^\\\\/.test(p) || /^\/\//.test(p)) return true;
    const m = /^([A-Za-z]:)/.exec(p);
    return !!m && letters.has(m[1].toUpperCase());
  };
}

module.exports = { executeDeletion, makeIsNetworkPath };
