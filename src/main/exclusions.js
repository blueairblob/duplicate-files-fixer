// Exclusion list logic — pure functions, no Node/Electron dependencies, fully testable.
// An exclusion entry is either:
//   - a plain folder/file name to match anywhere in the path  (e.g. "node_modules")
//   - a glob-ish pattern using * as wildcard                  (e.g. "*.tmp")
//   - an absolute path prefix                                  (e.g. "C:\\Windows")

const DEFAULT_EXCLUSIONS = [
  // VCS / dev tooling
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  // Windows system
  'System Volume Information',
  '$RECYCLE.BIN',
  'Windows',
  // Cloud sync caches — these change constantly and produce false-positive "duplicate" noise
  'OneDriveTemp',
  '.dropbox.cache',
  '.dff-quarantine', // our own quarantine folder must never be re-scanned
  // macOS metadata
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  // Common temp/cache junk
  '__pycache__',
  '.cache',
];

/**
 * Convert a glob-style pattern (using * as wildcard) into a RegExp.
 */
function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars except *
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Normalise a path to use forward slashes for consistent matching
 * across Windows (\) and POSIX (/) separators.
 */
function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Returns true if `filePath` should be excluded from scanning, given a list
 * of exclusion entries (strings — exact segment match, glob pattern, or path prefix).
 *
 * Matching rules:
 *  - Entry containing '*' is treated as a glob matched against each path segment
 *  - Entry containing a path separator is treated as a path-prefix match
 *  - Otherwise the entry is matched as an exact (case-insensitive) path segment
 */
function isExcluded(filePath, exclusions) {
  if (!exclusions || exclusions.length === 0) return false;

  const normalised = normalisePath(filePath);
  const segments = normalised.split('/').filter(Boolean);

  for (const rawEntry of exclusions) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    if (entry.includes('/') || entry.includes('\\')) {
      // Path-prefix style exclusion
      const normalisedEntry = normalisePath(entry);
      if (normalised.toLowerCase().startsWith(normalisedEntry.toLowerCase())) {
        return true;
      }
      continue;
    }

    if (entry.includes('*')) {
      const re = globToRegExp(entry);
      if (segments.some(seg => re.test(seg))) return true;
      continue;
    }

    // Exact segment match (case-insensitive) — matches a folder or file name anywhere in the path
    const lower = entry.toLowerCase();
    if (segments.some(seg => seg.toLowerCase() === lower)) return true;
  }

  return false;
}

module.exports = { DEFAULT_EXCLUSIONS, isExcluded, globToRegExp, normalisePath };
