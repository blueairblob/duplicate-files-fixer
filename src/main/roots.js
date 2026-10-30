// Scan-root analysis — pure functions, no Node/Electron dependencies.
//
// Protects against two ways a "duplicate" can turn out to be the only copy:
//   - overlapping roots: protected D:\Photos inside target D:\ walks every
//     protected file a second time as a target file;
//   - aliased roots: \\nas\share and a mapped Z:\ are the same folder under
//     two different path strings.
//
// Policy (agreed for Phase A):
//   - same folder on both sides, or target inside protected -> block the scan
//   - protected inside target -> skip that subtree when walking the target

// Rewrite a mapped drive path to its UNC form, e.g. Z:\x -> \\nas\share\x.
// `mappings` is [{ local: 'Z:', remote: '\\\\nas\\share' }].
function unmapDrive(p, mappings) {
  if (!p || !mappings || mappings.length === 0) return p;
  const m = /^([A-Za-z]:)(.*)$/.exec(p);
  if (!m) return p;
  const hit = mappings.find(x => x.local && x.local.toUpperCase() === m[1].toUpperCase());
  if (!hit || !hit.remote) return p;
  return hit.remote.replace(/[\\/]+$/, '') + (m[2] || '');
}

// Strip Windows long-path prefixes that realpath.native can return.
function stripLongPathPrefix(p) {
  if (!p) return p;
  if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8);
  if (p.startsWith('\\\\?\\')) return p.slice(4);
  return p;
}

// Forward slashes, no trailing slash (except a bare root), lower case on Windows.
function normaliseRoot(p, platform) {
  let s = stripLongPathPrefix(String(p || '')).replace(/\\/g, '/');
  const isUnc = s.startsWith('//');
  s = s.replace(/\/+$/, '');
  if (isUnc) s = '//' + s.replace(/^\/+/, '');
  if (s === '') s = '/';
  if (/^[A-Za-z]:$/.test(s)) s += '/';
  return platform === 'win32' ? s.toLowerCase() : s;
}

// True when normalised `child` sits strictly below normalised `parent`.
function isInside(child, parent) {
  if (child === parent) return false;
  const base = parent.endsWith('/') ? parent : parent + '/';
  return child.startsWith(base);
}

function canonical(p, { platform, mappings, realpaths } = {}) {
  const real = (realpaths && realpaths[p]) || p;
  return normaliseRoot(unmapDrive(stripLongPathPrefix(real), mappings), platform);
}

/**
 * @param {object} args
 * @param {string[]} args.protectedRoots
 * @param {string[]} args.targetRoots
 * @param {string}   args.platform   process.platform
 * @param {Array}    [args.mappings] mapped network drives (Windows)
 * @param {object}   [args.realpaths] given path -> resolved real path
 * @returns {{ blocked: Array<{protected:string,target:string,code:string,reason:string}>, excludeFromTarget: string[] }}
 *   code: 'same' | 'target-inside-protected' (lets each screen word it its own way)
 *   excludeFromTarget holds normalised paths (see normaliseRoot) in the
 *   target's own path form, ready to compare against walked directories.
 */
function analyseRoots({ protectedRoots = [], targetRoots = [], platform, mappings = [], realpaths = {} }) {
  const opts = { platform, mappings, realpaths };
  const blocked = [];
  const exclude = new Set();

  for (const t of targetRoots) {
    const ct = canonical(t, opts);
    const tGiven = normaliseRoot(t, platform);
    for (const p of protectedRoots) {
      const cp = canonical(p, opts);
      if (cp === ct) {
        blocked.push({ protected: p, target: t, code: 'same', reason: 'The protected source and the scan target are the same folder.' });
      } else if (isInside(ct, cp)) {
        blocked.push({ protected: p, target: t, code: 'target-inside-protected', reason: 'The scan target is inside the protected source.' });
      } else if (isInside(cp, ct)) {
        // Express the protected folder in the target's own path form, since
        // that is the string the worker sees while walking the target.
        const rel = cp.slice((ct.endsWith('/') ? ct : ct + '/').length);
        exclude.add(tGiven.endsWith('/') ? tGiven + rel : tGiven + '/' + rel);
      }
    }
  }

  return { blocked, excludeFromTarget: Array.from(exclude) };
}

module.exports = { analyseRoots, normaliseRoot, isInside, unmapDrive, stripLongPathPrefix };
