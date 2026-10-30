// One-time move of localStorage keys from the app's placeholder-name prefix
// ("dff-") to "holdfast-". The main process copies the old profile's Local
// Storage across on first start (src/main/migrate.js); this renames the keys.
// Safe to run every start: it only acts when the new key is missing.

const KEYS = ['scan-options', 'scan-history', 'theme', 'legacy-dpr-scaling'];

export function migrateStorage(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return 0;
  let moved = 0;
  for (const k of KEYS) {
    try {
      const oldKey = `dff-${k}`;
      const newKey = `holdfast-${k}`;
      const old = storage.getItem(oldKey);
      if (old !== null && storage.getItem(newKey) === null) {
        storage.setItem(newKey, old);
        moved++;
      }
      if (old !== null) storage.removeItem(oldKey);
    } catch { /* storage unavailable — nothing to migrate */ }
  }
  return moved;
}
