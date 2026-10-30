// Archive integrity record — pure functions, no I/O.
//
// An archive folder gets a "holdfast-integrity.jsonl" file: one header line,
// then one line per file with its path (relative, forward slashes), size,
// modified time and SHA-256. Re-checking an archive hashes every file again
// (never trusting caches: rot is exactly what caches would hide) and compares.
//
//   ok        — same bytes as recorded
//   corrupted — same size and date but different bytes: silent damage
//               (disk errors, bit rot) or tampering
//   modified  — different date or size: the file was changed on purpose (or
//               replaced); worth a look
//   missing   — recorded but no longer there
//   added     — there now but not in the record

const RECORD_NAME = 'holdfast-integrity.jsonl';
const RECORD_VERSION = 1;

function serializeRecord(entries, meta = {}) {
  const header = { holdfast: 'integrity-record', version: RECORD_VERSION, createdAt: new Date().toISOString(), files: entries.length, ...meta };
  const sorted = [...entries].sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  return [JSON.stringify(header), ...sorted.map(e => JSON.stringify({ p: e.p, s: e.s, m: e.m, h: e.h }))].join('\n') + '\n';
}

// Returns { header, entries } or throws on a file that isn't a record.
function parseRecord(text) {
  const lines = String(text || '').split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('The integrity record is empty');
  const header = JSON.parse(lines[0]);
  if (header.holdfast !== 'integrity-record') throw new Error('Not a Holdfast integrity record');
  if (header.version > RECORD_VERSION) throw new Error('This record was written by a newer Holdfast');
  const entries = [];
  for (const line of lines.slice(1)) {
    try { const e = JSON.parse(line); if (e && typeof e.p === 'string') entries.push(e); } catch { /* skip a damaged line */ }
  }
  return { header, entries };
}

/**
 * @param recorded  entries from the record
 * @param current   entries just measured ({ p, s, m, h }; h null if unreadable)
 */
function compareRecord(recorded, current) {
  const now = new Map(current.map(e => [e.p, e]));
  const out = { ok: [], corrupted: [], modified: [], missing: [], added: [], unreadable: [] };
  for (const r of recorded) {
    const c = now.get(r.p);
    if (!c) { out.missing.push(r); continue; }
    now.delete(r.p);
    if (!c.h) { out.unreadable.push({ ...r, error: c.error }); continue; }
    if (c.h === r.h) out.ok.push(c);
    else if (c.s === r.s && c.m === r.m) out.corrupted.push({ ...c, was: r });
    else out.modified.push({ ...c, was: r });
  }
  for (const c of now.values()) out.added.push(c);
  return out;
}

module.exports = { RECORD_NAME, serializeRecord, parseRecord, compareRecord };
