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

// Called when a scan STARTS, so abandoned attempts are retryable from
// History/Recents. Returns { list, id }; pass the id to updateHistoryEntry
// when (if) the scan completes.
export function addHistoryEntry(config) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    mode: config.mode,
    protectedFolders: config.protectedFolders || [],
    targetFolders: config.targetFolders || [],
    confidence: config.confidence || 'standard',
    status: 'started',        // 'started' | 'complete'
    duplicateGroups: null,
    totalScanned: 0,
  };
  const list = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  persist(list);
  return { list, id: entry.id };
}

// Called when a scan completes; fills in the summary counts.
export function updateHistoryEntry(id, result) {
  const list = loadHistory().map(e => e.id === id
    ? {
        ...e,
        status: 'complete',
        duplicateGroups: Array.isArray(result?.groups) ? result.groups.length : 0,
        totalScanned: result?.totalScanned ?? 0,
      }
    : e);
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
  if (e.status !== 'complete') return `${when} \u00b7 not completed`;
  const dupes = e.mode === 'verify' ? MODE_LABELS.verify : `${e.duplicateGroups} dupes`;
  return `${when} \u00b7 ${dupes}`;
}

export const CONFIDENCE_SHORT = { quick: 'Quick', standard: 'Standard', thorough: 'Thorough' };
