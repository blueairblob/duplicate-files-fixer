import { describe, it, expect } from 'vitest';
import { analyseRoots, normaliseRoot, isInside, unmapDrive, stripLongPathPrefix } from '../main/roots.js';

describe('normaliseRoot', () => {
  it('uses forward slashes and drops trailing separators', () => {
    expect(normaliseRoot('C:\\Photos\\', 'win32')).toBe('c:/photos');
    expect(normaliseRoot('/home/u/pics/', 'linux')).toBe('/home/u/pics');
  });
  it('keeps bare roots', () => {
    expect(normaliseRoot('D:\\', 'win32')).toBe('d:/');
    expect(normaliseRoot('D:', 'win32')).toBe('d:/');
    expect(normaliseRoot('/', 'linux')).toBe('/');
  });
  it('keeps UNC prefixes', () => {
    expect(normaliseRoot('\\\\NAS\\share\\x', 'win32')).toBe('//nas/share/x');
  });
  it('is case-sensitive off Windows', () => {
    expect(normaliseRoot('/mnt/D/Photos', 'linux')).toBe('/mnt/D/Photos');
  });
});

describe('isInside', () => {
  it('needs a separator boundary', () => {
    expect(isInside('d:/photos-old', 'd:/photos')).toBe(false);
    expect(isInside('d:/photos/2020', 'd:/photos')).toBe(true);
    expect(isInside('d:/photos', 'd:/')).toBe(true);
    expect(isInside('d:/photos', 'd:/photos')).toBe(false);
  });
});

describe('unmapDrive / stripLongPathPrefix', () => {
  const mappings = [{ local: 'Z:', remote: '\\\\nas\\share' }];
  it('rewrites a mapped drive to UNC', () => {
    expect(unmapDrive('z:\\photos', mappings)).toBe('\\\\nas\\share\\photos');
    expect(unmapDrive('C:\\photos', mappings)).toBe('C:\\photos');
  });
  it('strips \\\\?\\ prefixes', () => {
    expect(stripLongPathPrefix('\\\\?\\UNC\\nas\\share\\a')).toBe('\\\\nas\\share\\a');
    expect(stripLongPathPrefix('\\\\?\\C:\\a')).toBe('C:\\a');
  });
});

describe('analyseRoots', () => {
  it('passes disjoint roots', () => {
    const r = analyseRoots({ protectedRoots: ['D:\\Photos'], targetRoots: ['E:\\Backup'], platform: 'win32' });
    expect(r.blocked).toEqual([]);
    expect(r.excludeFromTarget).toEqual([]);
  });

  it('does not confuse sibling folders sharing a prefix', () => {
    const r = analyseRoots({ protectedRoots: ['D:\\Photos'], targetRoots: ['D:\\Photos-old'], platform: 'win32' });
    expect(r.blocked).toEqual([]);
    expect(r.excludeFromTarget).toEqual([]);
  });

  it('blocks the same folder on both sides (case-insensitive on Windows)', () => {
    const r = analyseRoots({ protectedRoots: ['D:\\Photos'], targetRoots: ['d:\\photos\\'], platform: 'win32' });
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].reason).toMatch(/same folder/);
  });

  it('blocks a target inside the protected source', () => {
    const r = analyseRoots({ protectedRoots: ['/data'], targetRoots: ['/data/backup'], platform: 'linux' });
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].reason).toMatch(/inside the protected/);
  });

  it('excludes a protected folder that sits inside the target', () => {
    const r = analyseRoots({ protectedRoots: ['D:\\Photos'], targetRoots: ['D:\\'], platform: 'win32' });
    expect(r.blocked).toEqual([]);
    expect(r.excludeFromTarget).toEqual(['d:/photos']);
  });

  it('catches a mapped drive aliasing a UNC path', () => {
    const r = analyseRoots({
      protectedRoots: ['\\\\nas\\share\\photos'],
      targetRoots: ['Z:\\photos'],
      platform: 'win32',
      mappings: [{ local: 'Z:', remote: '\\\\nas\\share' }],
    });
    expect(r.blocked).toHaveLength(1);
  });

  it('expresses the exclusion in the target path form when aliased', () => {
    const r = analyseRoots({
      protectedRoots: ['\\\\nas\\share\\photos'],
      targetRoots: ['Z:\\'],
      platform: 'win32',
      mappings: [{ local: 'Z:', remote: '\\\\nas\\share' }],
    });
    expect(r.blocked).toEqual([]);
    expect(r.excludeFromTarget).toEqual(['z:/photos']);
  });

  it('uses resolved real paths (symlinks, junctions)', () => {
    const r = analyseRoots({
      protectedRoots: ['/home/u/Pictures'],
      targetRoots: ['/mnt/nas/pics'],
      platform: 'linux',
      realpaths: { '/home/u/Pictures': '/mnt/nas/pics' },
    });
    expect(r.blocked).toHaveLength(1);
  });
});
