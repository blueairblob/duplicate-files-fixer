import { describe, it, expect } from 'vitest';

// Path utility helpers — breadcrumb splitting and parent resolution.
// These were originally used by FolderBrowserModal's custom folder tree (Sprint 2).
// The modal now delegates all browsing to the native OS dialog, but these
// utilities are retained and tested here because main.js uses similar path
// logic for getLocations and may be called on in future features.

function pathToBreadcrumbs(p) {
  if (!p) return [];
  const isWindows = /^[A-Za-z]:\\/.test(p);

  if (isWindows) {
    const parts = p.split(/[\\/]/).filter(Boolean);
    let acc = parts[0] + '\\';
    const crumbs = [{ label: parts[0] + '\\', path: acc }];
    for (let i = 1; i < parts.length; i++) {
      acc = acc + parts[i] + '\\';
      crumbs.push({ label: parts[i], path: acc.slice(0, -1) });
    }
    return crumbs;
  } else {
    const parts = p.split(/[\\/]/).filter(Boolean);
    let acc = '';
    const crumbs = [{ label: '/', path: '/' }];
    for (const part of parts) {
      acc = acc + '/' + part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }
}

function parentOf(p) {
  const crumbs = pathToBreadcrumbs(p);
  if (crumbs.length <= 1) return null;
  return crumbs[crumbs.length - 2].path;
}

describe('pathToBreadcrumbs — Windows paths', () => {
  it('splits a simple drive root', () => {
    const crumbs = pathToBreadcrumbs('C:\\');
    expect(crumbs).toEqual([{ label: 'C:\\', path: 'C:\\' }]);
  });

  it('splits a nested Windows path into breadcrumb segments', () => {
    const crumbs = pathToBreadcrumbs('C:\\Users\\Demo\\Documents');
    expect(crumbs.map(c => c.label)).toEqual(['C:\\', 'Users', 'Demo', 'Documents']);
  });

  it('each breadcrumb path accumulates correctly', () => {
    const crumbs = pathToBreadcrumbs('C:\\Users\\Demo');
    expect(crumbs[crumbs.length - 1].path).toBe('C:\\Users\\Demo');
    expect(crumbs[1].path).toBe('C:\\Users');
  });

  it('handles a network drive letter path', () => {
    const crumbs = pathToBreadcrumbs('Z:\\Shared\\Reports');
    expect(crumbs.map(c => c.label)).toEqual(['Z:\\', 'Shared', 'Reports']);
  });
});

describe('pathToBreadcrumbs — POSIX paths', () => {
  it('splits a simple root', () => {
    const crumbs = pathToBreadcrumbs('/');
    expect(crumbs).toEqual([{ label: '/', path: '/' }]);
  });

  it('splits a nested Linux path into breadcrumb segments', () => {
    const crumbs = pathToBreadcrumbs('/home/demo/Documents');
    expect(crumbs.map(c => c.label)).toEqual(['/', 'home', 'demo', 'Documents']);
  });

  it('each breadcrumb path accumulates correctly', () => {
    const crumbs = pathToBreadcrumbs('/home/demo/Documents');
    expect(crumbs[crumbs.length - 1].path).toBe('/home/demo/Documents');
    expect(crumbs[1].path).toBe('/home');
  });

  it('handles a WSL mount path', () => {
    const crumbs = pathToBreadcrumbs('/mnt/c/Users/Demo');
    expect(crumbs.map(c => c.label)).toEqual(['/', 'mnt', 'c', 'Users', 'Demo']);
  });

  it('handles a macOS /Volumes path', () => {
    const crumbs = pathToBreadcrumbs('/Volumes/External Drive');
    expect(crumbs.map(c => c.label)).toEqual(['/', 'Volumes', 'External Drive']);
  });
});

describe('parentOf', () => {
  it('returns null for a Windows drive root', () => {
    expect(parentOf('C:\\')).toBeNull();
  });

  it('returns null for the POSIX root', () => {
    expect(parentOf('/')).toBeNull();
  });

  it('returns the immediate parent for a nested Windows path', () => {
    expect(parentOf('C:\\Users\\Demo\\Documents')).toBe('C:\\Users\\Demo');
  });

  it('returns the immediate parent for a nested POSIX path', () => {
    expect(parentOf('/home/demo/Documents')).toBe('/home/demo');
  });

  it('returns the drive root as parent of a top-level folder', () => {
    expect(parentOf('C:\\Users')).toBe('C:\\');
  });
});
