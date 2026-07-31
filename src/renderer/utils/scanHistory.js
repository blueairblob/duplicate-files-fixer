// Scan history, persisted in localStorage. Each entry stores enough of the
// scan config to reload the setup (mode + folder lists) plus display metadata.
const KEY = 'dff-scan-history';
const MAX_ENTRIES = 20;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* non-fatal */ }
}

// config: the object HomeView passes to onStartScan.
// result: the scan result (used only for summary counts; may be partial).
export function addHistoryEntry(config, result) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    mode: config.mode,
    protectedFolders: config.protectedFolders || [],
    targetFolders: config.targetFolders || [],
    duplicateGroups: Array.isArray(result?.groups) ? result.groups.length : 0,
    totalScanned: result?.totalScanned ?? 0,
  };
  const list = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  persist(list);
  return list;
}

export function removeHistoryEntry(id) {
  const list = loadHistory().filter(e => e.id !== id);
  persist(list);
  return list;
}

export function clearHistory() {
  persist([]);
  return [];
}

// ── Display helpers ──────────────────────────────────────────────────────────
const MODE_LABELS = { compare: 'Compare', simple: 'Simple scan', verify: 'Verify backup' };

function leaf(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function entryTitle(e) {
  const src = e.protectedFolders[0] ? leaf(e.protectedFolders[0]) : null;
  const tgt = e.targetFolders[0] ? leaf(e.targetFolders[0]) : null;
  if (e.mode === 'simple') return tgt || 'Simple scan';
  if (src && tgt) return `${src} vs ${tgt}`;
  return MODE_LABELS[e.mode] || 'Scan';
}

export function entrySubtitle(e) {
  const d = new Date(e.date);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const when = sameDay(d, today) ? 'Today'
    : sameDay(d, yesterday) ? 'Yesterday'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const dupes = e.mode === 'verify' ? MODE_LABELS.verify : `${e.duplicateGroups} dupes`;
  return `${when} \u00b7 ${dupes}`;
}
