// Delete guard — pure functions, no Node/Electron dependencies.
//
// The main process keeps a "session" built from the last completed scan and
// checks every delete request against it. The renderer can't widen what gets
// deleted: a file must be a non-protected member of a duplicate group from
// that scan, must not sit under a protected root, and its group must keep a
// surviving copy unless the user explicitly acknowledged wiping it out.

const { normaliseRoot, isInside } = require('./roots');

function buildSession(result, config, platform) {
  const files = new Map();   // path -> { groupId, sourceLabel, size, modified, id }
  const groups = new Map();  // groupId -> [path]
  for (const g of (result && result.groups) || []) {
    const paths = [];
    for (const f of g.files || []) {
      files.set(f.path, { groupId: g.id, sourceLabel: f.sourceLabel, size: f.size, modified: f.modified, id: f.id || null, root: f.root || null });
      paths.push(f.path);
    }
    groups.set(g.id, paths);
  }
  const protectedRoots = config && config.mode !== 'simple' ? (config.protectedFolders || []) : [];
  return {
    platform,
    confidence: (result && result.confidence) || 'standard',
    protectedRoots: protectedRoots.map(p => normaliseRoot(p, platform)),
    files,
    groups,
  };
}

function isUnderProtectedRoot(filePath, session) {
  const p = normaliseRoot(filePath, session.platform);
  return session.protectedRoots.some(r => p === r || isInside(p, r));
}

/**
 * Decide which requested paths may be deleted, and against which kept copy.
 * @returns {{ items: Array<{path, file, counterpart, counterpartFile}>, rejected: Array<{path, reason}> }}
 */
function planDeletion(requestPaths, session, { allowNoSurvivor = false } = {}) {
  const unique = Array.from(new Set(requestPaths || []));
  if (!session) {
    return { items: [], rejected: unique.map(path => ({ path, reason: 'Scan results are out of date — run the scan again' })) };
  }

  const requested = new Set(unique);
  const items = [];
  const rejected = [];

  for (const path of unique) {
    const file = session.files.get(path);
    if (!file) { rejected.push({ path, reason: 'Not part of the current scan results' }); continue; }
    if (file.sourceLabel === 'protected' || isUnderProtectedRoot(path, session)) {
      rejected.push({ path, reason: 'Protected file — never deleted' });
      continue;
    }

    const survivors = (session.groups.get(file.groupId) || []).filter(p => p !== path && !requested.has(p));
    if (survivors.length === 0 && !allowNoSurvivor) {
      rejected.push({ path, reason: 'Would remove every copy — not deleted' });
      continue;
    }
    const counterpart = survivors.find(p => session.files.get(p)?.sourceLabel === 'protected') || survivors[0] || null;
    items.push({ path, file, counterpart, counterpartFile: counterpart ? session.files.get(counterpart) : null });
  }

  return { items, rejected };
}

// Drop deleted paths so a repeated request can't act on stale entries.
function forgetPaths(session, paths) {
  if (!session) return;
  for (const p of paths) {
    const f = session.files.get(p);
    if (!f) continue;
    session.files.delete(p);
    const g = session.groups.get(f.groupId);
    if (g) session.groups.set(f.groupId, g.filter(x => x !== p));
  }
}

module.exports = { buildSession, planDeletion, forgetPaths, isUnderProtectedRoot };
