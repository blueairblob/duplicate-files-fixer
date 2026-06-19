import { describe, it, expect } from 'vitest';
import { DEFAULT_EXCLUSIONS, isExcluded, globToRegExp, normalisePath } from '../main/exclusions.js';

describe('normalisePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalisePath('C:\\Users\\demo\\file.txt')).toBe('C:/Users/demo/file.txt');
  });
  it('leaves forward-slash paths unchanged', () => {
    expect(normalisePath('/home/demo/file.txt')).toBe('/home/demo/file.txt');
  });
});

describe('globToRegExp', () => {
  it('matches a simple wildcard extension pattern', () => {
    const re = globToRegExp('*.tmp');
    expect(re.test('cache.tmp')).toBe(true);
    expect(re.test('cache.txt')).toBe(false);
  });
  it('is case-insensitive', () => {
    const re = globToRegExp('*.TMP');
    expect(re.test('cache.tmp')).toBe(true);
  });
  it('escapes regex special characters in the literal portion', () => {
    const re = globToRegExp('file(1).txt');
    expect(re.test('file(1).txt')).toBe(true);
    expect(re.test('fileX1Xtxt')).toBe(false);
  });
});

describe('isExcluded — exact segment match', () => {
  it('excludes a folder by exact name match anywhere in the path', () => {
    expect(isExcluded('/home/dev/project/node_modules/lodash/index.js', ['node_modules'])).toBe(true);
  });
  it('does not exclude unrelated paths', () => {
    expect(isExcluded('/home/dev/project/src/index.js', ['node_modules'])).toBe(false);
  });
  it('matches case-insensitively', () => {
    expect(isExcluded('C:\\Project\\NODE_MODULES\\pkg\\file.js', ['node_modules'])).toBe(true);
  });
  it('works with Windows-style paths', () => {
    expect(isExcluded('C:\\Windows\\System32\\file.dll', ['Windows'])).toBe(true);
  });
});

describe('isExcluded — glob patterns', () => {
  it('excludes files matching a wildcard extension', () => {
    expect(isExcluded('/tmp/cache/build.tmp', ['*.tmp'])).toBe(true);
  });
  it('does not exclude non-matching extensions', () => {
    expect(isExcluded('/tmp/cache/build.log', ['*.tmp'])).toBe(false);
  });
});

describe('isExcluded — path-prefix patterns', () => {
  it('excludes everything under a specified absolute path', () => {
    expect(isExcluded('C:\\Windows\\System32\\drivers\\file.sys', ['C:\\Windows'])).toBe(true);
  });
  it('does not exclude sibling paths with similar prefix text', () => {
    expect(isExcluded('C:\\WindowsApps\\file.txt', ['C:\\Windows\\'])).toBe(false);
  });
});

describe('isExcluded — multiple entries', () => {
  it('excludes if ANY entry in the list matches', () => {
    const exclusions = ['node_modules', '.git', '*.tmp'];
    expect(isExcluded('/repo/.git/HEAD', exclusions)).toBe(true);
    expect(isExcluded('/repo/build/output.tmp', exclusions)).toBe(true);
    expect(isExcluded('/repo/src/main.js', exclusions)).toBe(false);
  });

  it('returns false for an empty exclusion list', () => {
    expect(isExcluded('/any/path/file.txt', [])).toBe(false);
  });

  it('returns false when exclusions is undefined', () => {
    expect(isExcluded('/any/path/file.txt', undefined)).toBe(false);
  });

  it('ignores blank/whitespace-only entries', () => {
    expect(isExcluded('/any/path/file.txt', ['', '   '])).toBe(false);
  });
});

describe('DEFAULT_EXCLUSIONS', () => {
  it('includes essential dev tooling exclusions', () => {
    expect(DEFAULT_EXCLUSIONS).toContain('node_modules');
    expect(DEFAULT_EXCLUSIONS).toContain('.git');
  });
  it('includes the quarantine folder itself to avoid re-scanning deleted files', () => {
    expect(DEFAULT_EXCLUSIONS).toContain('.dff-quarantine');
  });
  it('includes Windows system folders', () => {
    expect(DEFAULT_EXCLUSIONS).toContain('System Volume Information');
    expect(DEFAULT_EXCLUSIONS).toContain('$RECYCLE.BIN');
  });
  it('includes macOS metadata folders', () => {
    expect(DEFAULT_EXCLUSIONS).toContain('.DS_Store');
  });
  it('default list correctly excludes a realistic dev project path', () => {
    expect(isExcluded('/home/dev/myapp/node_modules/react/index.js', DEFAULT_EXCLUSIONS)).toBe(true);
    expect(isExcluded('/home/dev/myapp/.git/config', DEFAULT_EXCLUSIONS)).toBe(true);
    expect(isExcluded('/home/dev/myapp/src/App.jsx', DEFAULT_EXCLUSIONS)).toBe(false);
  });
});
