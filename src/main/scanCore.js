// Scan core — the pure decisions behind a scan, no I/O. The worker does the
// walking and hashing, then hands its file lists to these functions. Tests
// import this module directly.

const path = require('path');

// File-type filters. Only used when the user picks types; with no types picked,
// EVERY file is scanned (an allowlist used to silently skip RAW photos, TIFFs,
// and anything else not listed — fatal for a backup check).
const TYPE_MAP = {
  photos:   ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.avif', '.jxl', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.psd',
             '.raw', '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.orf', '.rw2', '.raf', '.srw', '.pef', '.x3f', '.3fr', '.iiq'],
  audio:    ['.mp3', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.wma', '.aif', '.aiff', '.alac', '.ape', '.mid', '.midi'],
  video:    ['.mp4', '.m4v', '.mov', '.avi', '.mkv', '.wmv', '.webm', '.mts', '.m2ts', '.ts', '.3gp', '.mpg', '.mpeg', '.vob', '.flv', '.insv'],
  docs:     ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.md', '.csv',
             '.pages', '.numbers', '.key', '.epub', '.eml', '.msg'],
  archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso', '.dmg'],
};

function shouldIncludeFile(filePath, filters) {
  const types = (filters && filters.types) || [];
  if (types.length === 0) return true;
  const ext = path.extname(filePath).toLowerCase();
  return types.some(t => (TYPE_MAP[t] || []).includes(ext));
}

// Files sharing a size with at least one other file — the only ones worth
// hashing. Deduped by path and sorted so reads arrive in directory order
// (friendly to spinning-disk NAS read-ahead).
function sizeCandidates(files) {
  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }
  const seen = new Set();
  const out = [];
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    for (const f of group) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(f);
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// The copy to keep comes first.
function sortForKeep(files, rule) {
  if (rule === 'keep-oldest') return [...files].sort((a, b) => new Date(a.modified) - new Date(b.modified));
  if (rule === 'keep-largest') return [...files].sort((a, b) => b.size - a.size);
  return [...files].sort((a, b) => new Date(b.modified) - new Date(a.modified)); // keep-newest (default)
}

// Duplicate groups for compare/simple modes. In compare mode a group that
// contains a protected copy marks every target copy; otherwise the auto-mark
// rule picks one survivor.
function buildGroups(fileMap, mode, autoMarkRule) {
  const groups = [];
  let id = 0;
  for (const [hash, files] of fileMap.entries()) {
    if (files.length < 2) continue;
    const hasProtected = files.some(f => f.sourceLabel === 'protected');
    const hasTarget = files.some(f => f.sourceLabel === 'target');
    if (mode === 'compare' && !hasTarget) continue;
    const autoMarked = mode === 'compare' && hasProtected
      ? files.filter(f => f.sourceLabel === 'target').map(f => f.path)
      : sortForKeep(files, autoMarkRule).slice(1).map(f => f.path);
    groups.push({ id: id++, hash, files, autoMarked, hasProtected });
  }
  return groups;
}

function groupIndex(fileMap) {
  const groupOf = new Map();
  for (const files of fileMap.values()) for (const f of files) groupOf.set(f.path, files);
  return groupOf;
}

const sum = arr => arr.reduce((a, f) => a + (f.size || 0), 0);
const brief = f => ({ path: f.path, size: f.size, modified: f.modified, ext: f.ext });
const LIST_CAP = 5000;

// ── Census: the source-vs-target relationship (compare mode) ─────────────────
//
// Matching is CONTENT-ANYWHERE: a target file is "in both" when its content
// exists anywhere in the protected source. Source-only is counted over
// distinct source files (one source file can match many target copies).
// Files that couldn't be read are their own bucket — never "not backed up".
function buildCensus(files, fileMap, protectedFolders, targetFolders, unreadable = new Set()) {
  const groupOf = groupIndex(fileMap);
  const inGroupWith = (f, label) => { const g = groupOf.get(f.path); return !!g && g.some(x => x.sourceLabel === label); };

  const srcFiles = files.filter(f => f.sourceLabel === 'protected');
  const tgtFiles = files.filter(f => f.sourceLabel === 'target');

  const matchedTarget = [], targetOnly = [], unreadTarget = [];
  for (const f of tgtFiles) {
    if (unreadable.has(f.path)) unreadTarget.push(f);
    else (inGroupWith(f, 'protected') ? matchedTarget : targetOnly).push(f);
  }
  const sourceOnly = [], unreadSource = [];
  let matchedSourceCount = 0;
  for (const f of srcFiles) {
    if (unreadable.has(f.path)) unreadSource.push(f);
    else if (inGroupWith(f, 'target')) matchedSourceCount++;
    else sourceOnly.push(f);
  }

  // Folder rollup over TARGET files only. Keyed by root + relative path, so
  // same-named folders under different target roots stay separate.
  const folderMap = new Map();
  let pathBudget = 200000;   // cap so a million-file scan can't blow the payload
  for (const f of tgtFiles) {
    const rel = path.relative(f.root || '', path.dirname(f.path)) || '.';
    const key = `${f.root || ''}\u0000${rel}`;
    if (!folderMap.has(key)) {
      folderMap.set(key, { key, path: rel, root: f.root, files: 0, matched: 0, targetOnly: 0, unreadable: 0, bytes: 0, reclaimable: 0, matchedPaths: [], truncated: false });
    }
    const e = folderMap.get(key);
    e.files++;
    e.bytes += f.size || 0;
    if (unreadable.has(f.path)) { e.unreadable++; continue; }
    if (inGroupWith(f, 'protected')) {
      e.matched++;
      e.reclaimable += f.size || 0;
      if (pathBudget > 0) { e.matchedPaths.push(f.path); pathBudget--; } else e.truncated = true;
    } else e.targetOnly++;
  }
  const folders = Array.from(folderMap.values()).map(e => ({
    ...e,
    state: e.matched === e.files ? 'all' : e.matched === 0 ? 'none' : 'partial',
  })).sort((a, b) => b.reclaimable - a.reclaimable);

  return {
    roots: {
      source: { paths: protectedFolders || [], files: srcFiles.length, bytes: sum(srcFiles) },
      target: { paths: targetFolders || [], files: tgtFiles.length, bytes: sum(tgtFiles) },
    },
    matched:    { targetFiles: matchedTarget.length, sourceFiles: matchedSourceCount, bytes: sum(matchedTarget) },
    sourceOnly: { files: sourceOnly.length, bytes: sum(sourceOnly), list: sourceOnly.slice(0, LIST_CAP).map(brief) },
    targetOnly: { files: targetOnly.length, bytes: sum(targetOnly), list: targetOnly.slice(0, LIST_CAP).map(brief) },
    unreadable: {
      sourceFiles: unreadSource.length, targetFiles: unreadTarget.length,
      list: [...unreadSource, ...unreadTarget].slice(0, LIST_CAP).map(f => ({ ...brief(f), side: f.sourceLabel })),
    },
    folders,
  };
}

// Numbers that must reconcile. Returned (not thrown) so a bad rollup is
// logged loudly without killing the scan.
function censusProblems(c) {
  const checks = [
    ['target total', c.matched.targetFiles + c.targetOnly.files + c.unreadable.targetFiles, c.roots.target.files],
    ['source total', c.matched.sourceFiles + c.sourceOnly.files + c.unreadable.sourceFiles, c.roots.source.files],
    ['folder total', c.folders.reduce((a, f) => a + f.files, 0), c.roots.target.files],
  ];
  return checks.filter(([, got, want]) => got !== want).map(([name, got, want]) => `${name}: ${got} !== ${want}`);
}

// ── Verify report: is every SOURCE file present in the BACKUP? ───────────────
// protected = source (the originals), target = backup. Matching is
// content-anywhere, like the census.
//   missing     — source files with no copy in the backup (the risk)
//   backedUp    — source files with a copy in the backup
//   backupOnly  — backup files whose content isn't in the source (informational)
//   unreadable  — couldn't be read, so unknown either way
function buildVerifyReport(files, fileMap, unreadable = new Set()) {
  const groupOf = groupIndex(fileMap);
  const backedUp = [], missing = [], backupOnly = [], unreadableList = [];

  for (const f of files) {
    if (unreadable.has(f.path)) { unreadableList.push(f); continue; }
    const g = groupOf.get(f.path);
    if (f.sourceLabel === 'protected') {
      const copy = g && g.find(x => x.sourceLabel === 'target');
      if (copy) backedUp.push({ source: f, backup: copy });
      else missing.push(f);
    } else if (!(g && g.some(x => x.sourceLabel === 'protected'))) {
      backupOnly.push(f);
    }
  }

  const byPath = (a, b) => a.path.localeCompare(b.path);
  missing.sort(byPath);
  backupOnly.sort(byPath);
  unreadableList.sort(byPath);
  backedUp.sort((a, b) => a.source.path.localeCompare(b.source.path));

  return {
    backedUp, missing, backupOnly, unreadable: unreadableList,
    summary: {
      totalSource: files.filter(f => f.sourceLabel === 'protected').length,
      totalBackup: files.filter(f => f.sourceLabel === 'target').length,
      backedUpCount: backedUp.length, backedUpSize: sum(backedUp.map(m => m.source)),
      missingCount: missing.length, missingSize: sum(missing),
      backupOnlyCount: backupOnly.length, backupOnlySize: sum(backupOnly),
      unreadableSourceCount: unreadableList.filter(f => f.sourceLabel === 'protected').length,
      unreadableBackupCount: unreadableList.filter(f => f.sourceLabel === 'target').length,
    },
  };
}

module.exports = {
  TYPE_MAP, shouldIncludeFile, sizeCandidates, sortForKeep, buildGroups,
  buildCensus, censusProblems, buildVerifyReport,
};
