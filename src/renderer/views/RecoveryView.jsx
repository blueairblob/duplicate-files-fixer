import React, { useState, useEffect, useCallback } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

const api = window.electronAPI;

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export default function RecoveryView({ onBack }) {
  const { scale } = useDPR();

  const [entries, setEntries] = useState(null); // null = still loading
  const [busy, setBusy]       = useState({});   // quarantinePath -> true while restoring
  const [notes, setNotes]     = useState({});   // quarantinePath -> { type, msg }

  const load = useCallback(async () => {
    setEntries(null);
    if (!api) { setEntries([]); return; }
    try {
      const manifest = await api.getQuarantineManifest();
      setEntries(Array.isArray(manifest) ? manifest : []);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (entry) => {
    if (!api) return;
    const key = entry.quarantinePath;
    setBusy(b => ({ ...b, [key]: true }));
    setNotes(n => { const c = { ...n }; delete c[key]; return c; });
    try {
      const res = await api.restoreFromQuarantine(key);
      if (res && res.success) {
        setEntries(list => list.filter(e => e.quarantinePath !== key));
      } else {
        setNotes(n => ({ ...n, [key]: { type: 'err', msg: (res && res.error) || 'Restore failed' } }));
      }
    } catch (e) {
      setNotes(n => ({ ...n, [key]: { type: 'err', msg: e.message } }));
    } finally {
      setBusy(b => { const c = { ...b }; delete c[key]; return c; });
    }
  };

  const btnSecondary = {
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: `${scale(7)}px ${scale(12)}px`, fontSize: scale(11), cursor: 'pointer',
  };
  const btnRestore = {
    background: 'var(--teal-dim)', color: 'var(--teal)',
    border: '1px solid var(--teal)', borderRadius: 'var(--radius-sm)',
    padding: `${scale(6)}px ${scale(14)}px`, fontSize: scale(11), fontWeight: 600, cursor: 'pointer',
    flexShrink: 0,
  };
  const label = { fontSize: scale(10), fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: scale(20), overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: scale(14) }}>
        <div>
          <div style={label}>Recover</div>
          <h2 style={{ fontSize: scale(18), color: 'var(--text-primary)', margin: `${scale(2)}px 0 0` }}>Quarantined files</h2>
        </div>
        <div style={{ display: 'flex', gap: scale(8) }}>
          <button onClick={load} style={btnSecondary}>↻ Refresh</button>
          <button onClick={onBack} style={btnSecondary}>← Home</button>
        </div>
      </div>

      {/* Explainer */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: `${scale(10)}px ${scale(14)}px`, marginBottom: scale(16),
      }}>
        <p style={{ fontSize: scale(11), color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          This lists files moved to the app's own quarantine — the fallback used only when a delete
          couldn't reach the system Recycle Bin. Files sent to the <strong>Windows Recycle Bin</strong> are
          not shown here; recover those from the Recycle Bin on your desktop.
        </p>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {entries === null && (
          <p style={{ fontSize: scale(12), color: 'var(--text-muted)', padding: scale(20), textAlign: 'center' }}>Loading…</p>
        )}

        {entries !== null && entries.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: scale(8), color: 'var(--text-muted)' }}>
            <div style={{ fontSize: scale(30) }}>🗃️</div>
            <p style={{ fontSize: scale(13), color: 'var(--text-secondary)' }}>Quarantine is empty — nothing to recover.</p>
            <p style={{ fontSize: scale(11) }}>Anything you deleted went to the Windows Recycle Bin instead.</p>
          </div>
        )}

        {entries !== null && entries.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div style={{ padding: `${scale(8)}px ${scale(14)}px`, fontSize: scale(11), color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
              {entries.length} file{entries.length !== 1 ? 's' : ''} in quarantine
            </div>
            {entries.map((entry) => {
              const key = entry.quarantinePath;
              const note = notes[key];
              return (
                <div key={key} style={{ padding: `${scale(10)}px ${scale(14)}px`, borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: scale(12) }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: scale(12), color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {basename(entry.originalPath)}
                      </div>
                      <div style={{ fontSize: scale(10), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {entry.originalPath}
                      </div>
                      {entry.deletedAt && (
                        <div style={{ fontSize: scale(10), color: 'var(--text-muted)', marginTop: scale(2) }}>
                          Deleted {formatDate(entry.deletedAt)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(entry)}
                      disabled={!!busy[key]}
                      style={{ ...btnRestore, opacity: busy[key] ? 0.5 : 1, cursor: busy[key] ? 'default' : 'pointer' }}
                    >
                      {busy[key] ? 'Restoring…' : '↩ Restore'}
                    </button>
                  </div>
                  {note && (
                    <div style={{ fontSize: scale(10), color: note.type === 'err' ? 'var(--red)' : 'var(--teal)', marginTop: scale(6) }}>
                      {note.type === 'err' ? '⚠ ' : '✓ '}{note.msg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
