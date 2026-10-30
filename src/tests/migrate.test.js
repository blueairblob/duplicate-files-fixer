import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateUserData } from '../main/migrate.js';
import { migrateStorage } from '../renderer/utils/migrateStorage.js';

// Carrying data over from the placeholder name to Holdfast.

let tmp, appData, oldDir, newDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-migrate-'));
  appData = path.join(tmp, 'AppData');
  oldDir = path.join(appData, 'Duplicate Files Fixer');
  newDir = path.join(appData, 'Holdfast');
  fs.mkdirSync(path.join(oldDir, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'dff-signature-cache.json'), '{"version":1,"entries":{}}');
  fs.writeFileSync(path.join(oldDir, 'dff-exclusions.json'), JSON.stringify(['node_modules', '.dff-quarantine', '*.tmp']));
  fs.writeFileSync(path.join(oldDir, 'dff-quarantine-dirs.json'), JSON.stringify(['Z:\\.dff-quarantine']));
  fs.writeFileSync(path.join(oldDir, 'Local Storage', 'leveldb', '000003.log'), 'ls');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('migrateUserData', () => {
  it('copies cache, exclusions, quarantine registry and Local Storage once', () => {
    const r = migrateUserData({ appDataDir: appData, userDataDir: newDir });
    expect(r.skipped).toBe(false);
    expect(fs.readFileSync(path.join(newDir, 'holdfast-signature-cache.json'), 'utf8')).toContain('"version":1');
    expect(JSON.parse(fs.readFileSync(path.join(newDir, 'holdfast-exclusions.json'), 'utf8')))
      .toEqual(['node_modules', '.holdfast-quarantine', '*.tmp']);
    // Old quarantine folders stay registered, so their files stay restorable.
    expect(JSON.parse(fs.readFileSync(path.join(newDir, 'holdfast-quarantine-dirs.json'), 'utf8'))).toEqual(['Z:\\.dff-quarantine']);
    expect(fs.existsSync(path.join(newDir, 'Local Storage', 'leveldb', '000003.log'))).toBe(true);
    // The old folder is left alone.
    expect(fs.existsSync(path.join(oldDir, 'dff-exclusions.json'))).toBe(true);
  });

  it('runs only once and never overwrites newer data', () => {
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'holdfast-exclusions.json'), '["mine"]');
    migrateUserData({ appDataDir: appData, userDataDir: newDir });
    expect(fs.readFileSync(path.join(newDir, 'holdfast-exclusions.json'), 'utf8')).toBe('["mine"]');
    expect(migrateUserData({ appDataDir: appData, userDataDir: newDir }).skipped).toBe(true);
  });

  it('does nothing harmful on a fresh install', () => {
    fs.rmSync(oldDir, { recursive: true });
    const r = migrateUserData({ appDataDir: appData, userDataDir: newDir });
    expect(r.copied).toEqual([]);
  });
});

describe('migrateStorage', () => {
  const fake = (init) => {
    const m = new Map(Object.entries(init));
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m };
  };
  it('renames old keys and keeps newer values', () => {
    const s = fake({ 'dff-scan-history': '[1]', 'dff-theme': 'dark', 'holdfast-theme': 'light' });
    migrateStorage(s);
    expect(s.getItem('holdfast-scan-history')).toBe('[1]');
    expect(s.getItem('holdfast-theme')).toBe('light');
    expect(s.getItem('dff-scan-history')).toBeNull();
    expect(s.getItem('dff-theme')).toBeNull();
  });
});
