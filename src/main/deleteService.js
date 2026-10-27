// Delete service — the main process's delete/quarantine/restore wiring.
//
// Kept free of Electron imports (the Recycle Bin call is injected) so the same
// code runs in the app and in tools/phase-a-check.js against a real NAS.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planDeletion, forgetPaths } = require('./deleteGuard');
const { executeDeletion, makeIsNetworkPath } = require('./deleteFiles');
const { quarantineFile, listQuarantine, restoreFile } = require('./quarantine');
const { getNetworkMappings } = require('./system');

// Same size/mtime/identity format the scan worker records.
async function statForDelete(p) {
  const st = await fs.promises.stat(p, { bigint: true });
  return { size: Number(st.size), modified: st.mtime.toISOString(), id: st.ino !== 0n ? `${st.dev}:${st.ino}` : null };
}

function hashFull(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const st = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    st.on('data', d => h.update(d));
    st.on('end', () => resolve(h.digest('hex')));
    st.on('error', reject);
  });
}

/**
 * @param {object} opts
 *   userDataDir  where the signature cache and quarantine registry live
 *   homeDir      last-resort quarantine location (and the legacy one)
 *   trash(p)     OS Recycle Bin (Electron's shell.trashItem)
 */
function createDeleteService({ userDataDir, homeDir, trash }) {
  const sigCachePath = path.join(userDataDir, 'dff-signature-cache.json');
  const registryPath = path.join(userDataDir, 'dff-quarantine-dirs.json');
  const legacyDir = path.join(homeDir, '.dff-quarantine');

  // Every quarantine folder ever used, so Recovery can list them all.
  async function quarantineDirs() {
    let dirs = [];
    try { dirs = JSON.parse(await fs.promises.readFile(registryPath, 'utf8')); } catch { /* none yet */ }
    if (!Array.isArray(dirs)) dirs = [];
    return Array.from(new Set([legacyDir, ...dirs]));
  }
  async function rememberDir(dir) {
    const dirs = await quarantineDirs();
    if (dirs.includes(dir)) return;
    const next = [...dirs.filter(d => d !== legacyDir), dir];
    const tmp = registryPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.promises.rename(tmp, registryPath);
  }

  async function deleteFiles(session, payload, onProgress) {
    const paths = ((payload && payload.files) || [])
      .map(f => (typeof f === 'string' ? f : f && f.path))
      .filter(Boolean);
    const { items, rejected } = planDeletion(paths, session, { allowNoSurvivor: !!(payload && payload.allowNoSurvivor) });

    // Reuse the scan's signature cache when (size, mtime) still match — most
    // verifications then cost zero reads.
    let sigCache = null;
    const hash = async (p) => {
      if (!sigCache) {
        try { sigCache = JSON.parse(await fs.promises.readFile(sigCachePath, 'utf8')); } catch { sigCache = { entries: {} }; }
      }
      try {
        const s = await statForDelete(p);
        const e = sigCache.entries && sigCache.entries[p];
        if (e && e.size === s.size && e.m === s.modified && e.fh) return e.fh;
      } catch { /* fall through to reading */ }
      return hashFull(p);
    };

    const results = await executeDeletion(items, {
      stat: statForDelete,
      hash,
      trash,
      quarantine: async (p, file) => {
        const r = await quarantineFile(p, { scanRoot: file.root, homeDir });
        try { await rememberDir(r.dir); } catch (e) { console.error('[delete] could not record quarantine folder', r.dir, e.message); }
        return r;
      },
      isNetworkPath: makeIsNetworkPath(process.platform, await getNetworkMappings()),
      verifyContent: !session || session.confidence !== 'thorough',
      onProgress,
    });

    forgetPaths(session, [...results.trashed, ...results.quarantined]);
    results.skipped.unshift(...rejected);
    results.deleted = [...results.trashed, ...results.quarantined];
    return results;
  }

  return {
    deleteFiles,
    listQuarantine: async () => listQuarantine(await quarantineDirs()),
    restore: async (quarantinePath) => restoreFile(quarantinePath, await quarantineDirs()),
    quarantineDirs,
  };
}

module.exports = { createDeleteService, statForDelete };
