// One-time migration from the app's placeholder name to Holdfast.
//
// Before the rename, the app kept its data under an app-data folder named
// after the placeholder, with "dff-" file names. On first start as Holdfast
// this copies that data across, once, so the signature cache, exclusions,
// quarantine registry and the renderer's settings/history aren't lost.
// Nothing is deleted from the old folder.
//
// These legacy names exist only here (and in the matching renderer shim,
// utils/migrateStorage.js, plus the legacy quarantine folder in
// deleteService/scanWorker). They can go once nobody upgrades from a
// pre-Holdfast build.

const fs = require('fs');
const path = require('path');

const LEGACY_APPDATA_NAMES = ['Duplicate Files Fixer', 'duplicate-files-fixer'];
const FILE_MAP = [
  ['dff-signature-cache.json', 'holdfast-signature-cache.json'],
  ['dff-signature-cache.json.meta.json', 'holdfast-signature-cache.json.meta.json'],
  ['dff-exclusions.json', 'holdfast-exclusions.json'],
  ['dff-quarantine-dirs.json', 'holdfast-quarantine-dirs.json'],
];
const MARKER = 'holdfast-migrated.json';
const LEGACY_QUARANTINE = '.dff-quarantine';

/**
 * @param {object} o  { appDataDir, userDataDir, legacyNames? }
 * @returns {{ skipped: boolean, copied: string[] }}
 */
function migrateUserData({ appDataDir, userDataDir, legacyNames = LEGACY_APPDATA_NAMES }) {
  const marker = path.join(userDataDir, MARKER);
  if (fs.existsSync(marker)) return { skipped: true, copied: [] };
  fs.mkdirSync(userDataDir, { recursive: true });

  const copied = [];
  for (const name of legacyNames) {
    const oldDir = path.join(appDataDir, name);
    if (!fs.existsSync(oldDir) || path.resolve(oldDir) === path.resolve(userDataDir)) continue;

    for (const [from, to] of FILE_MAP) {
      const src = path.join(oldDir, from);
      const dest = path.join(userDataDir, to);
      if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
      try {
        if (to === 'holdfast-exclusions.json') {
          // The app's own quarantine folder entry gets its new name.
          const list = JSON.parse(fs.readFileSync(src, 'utf8'));
          const next = Array.isArray(list) ? list.map(e => (e === LEGACY_QUARANTINE ? '.holdfast-quarantine' : e)) : list;
          fs.writeFileSync(dest, JSON.stringify(next, null, 2));
        } else {
          fs.copyFileSync(src, dest);
        }
        copied.push(to);
      } catch { /* best effort: a missing cache just means a slower first scan */ }
    }

    // Renderer settings and history (Chromium's localStorage). Must happen
    // before the first window opens the profile.
    const oldLs = path.join(oldDir, 'Local Storage');
    const newLs = path.join(userDataDir, 'Local Storage');
    if (fs.existsSync(oldLs) && !fs.existsSync(newLs)) {
      try { fs.cpSync(oldLs, newLs, { recursive: true }); copied.push('Local Storage'); } catch { /* best effort */ }
    }
  }

  try { fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), copied }, null, 2)); } catch { /* retry next start */ }
  return { skipped: false, copied };
}

module.exports = { migrateUserData, LEGACY_QUARANTINE };
