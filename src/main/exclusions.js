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
  // Windows system. 'C:\\Windows' is a path prefix, not a bare name, so a
  // user's own folder called "Windows" (say, in a backup) is still scanned.
  'System Volume Information',
  '$RECYCLE.BIN',
  'C:\\Windows',
  // Cloud sync caches — these change constantly and produce false-positive "duplicate" noise
  'OneDriveTemp',
  '.dropbox.cache',
  '.holdfast-quarantine', // our own quarantine folder must never be re-scanned
  // macOS metadata
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  // NAS metadata (Synology/QNAP) — thumbnail/index stores; scanning these over
  // SMB is slow and produces junk duplicate groups
  '@eaDir',
  '#recycle',
  '#snapshot',
  '.snapshot',
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
 * Pre-process an exclusion list once per scan (regexes and lower-casing used
 * to be redone for every file):
 *  - entry containing '*'         -> glob, matched against each path segment
 *  - entry containing a separator -> path prefix (with a folder boundary, so
 *                                    "D:\\Photos" does not exclude "D:\\Photos-old")
 *  - anything else                -> exact segment name, case-insensitive
 */
function compileExclusions(exclusions) {
  const compiled = { names: new Set(), globs: [], prefixes: [], compiled: true };
  for (const raw of exclusions || []) {
    const entry = String(raw || '').trim();
    if (!entry) continue;
    if (entry.includes('/') || entry.includes('\\')) {
      compiled.prefixes.push(normalisePath(entry).replace(/\/+$/, '').toLowerCase());
    } else if (entry.includes('*')) {
      compiled.globs.push(globToRegExp(entry));
    } else {
      compiled.names.add(entry.toLowerCase());
    }
  }
  return compiled;
}

/**
 * True if `filePath` should be skipped.
 * @param exclusions  an array of entries, or the result of compileExclusions
 * @param root        the scan root. Name/glob entries only match segments BELOW
 *                    it, so a root that itself sits inside e.g. ".cache" or a
 *                    "Windows" folder isn't silently scanned as empty.
 */
function isExcluded(filePath, exclusions, root) {
  if (!exclusions) return false;
  const m = exclusions.compiled ? exclusions : compileExclusions(exclusions);
  if (m.names.size === 0 && m.globs.length === 0 && m.prefixes.length === 0) return false;

  const normalised = normalisePath(filePath);
  const lower = normalised.toLowerCase();
  for (const prefix of m.prefixes) {
    if (lower === prefix || lower.startsWith(prefix + '/')) return true;
  }

  let rel = normalised;
  if (root) {
    const r = normalisePath(root).replace(/\/+$/, '');
    if (lower.startsWith(r.toLowerCase() + '/')) rel = normalised.slice(r.length + 1);
  }
  for (const seg of rel.split('/')) {
    if (!seg) continue;
    if (m.names.has(seg.toLowerCase())) return true;
    for (const re of m.globs) if (re.test(seg)) return true;
  }
  return false;
}

module.exports = { DEFAULT_EXCLUSIONS, isExcluded, compileExclusions, globToRegExp, normalisePath };
