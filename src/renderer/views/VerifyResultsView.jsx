import React, { useState, useMemo } from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';

// Cap how many rows we drop into the DOM per section. Verify scans can involve
// tens of thousands of files; rendering them all at once would jank the window.
const ROW_CAP = 500;

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function fileIcon(ext) {
  const map = {
    '.jpg':'🖼','.jpeg':'🖼','.png':'🖼','.gif':'🖼','.heic':'🖼','.webp':'🖼','.bmp':'🖼',
    '.mp3':'🎵','.aac':'🎵','.flac':'🎵','.wav':'🎵','.m4a':'🎵',
    '.mp4':'🎬','.mov':'🎬','.avi':'🎬','.mkv':'🎬',
    '.pdf':'📄','.docx':'📝','.xlsx':'📊','.pptx':'📑','.txt':'📃',
    '.zip':'📦','.rar':'📦','.7z':'📦','.eml':'📧',
  };
  return map[ext] || '📄';
}

function makeStyles(scale) {
  return {
    label:  { fontSize: scale(10), fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' },
    btnSecondary: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: `${scale(7)}px ${scale(12)}px`, fontSize: scale(11), cursor: 'pointer' },
    card: { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: `${scale(14)}px ${scale(16)}px`, flex: 1 },
  };
}

export default function VerifyResultsView({ scanResult, scanConfig, onBack }) {
  const { scale } = useDPR();
  const S = makeStyles(scale);
  const report = scanResult?.verifyReport;

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState({ missing: true, unreadable: true, backedUp: false, backupOnly: false });
  const confidence = scanResult?.confidence || 'standard';

  // The question this screen answers: is every SOURCE file in the BACKUP?
  // Rows are flattened to { name, size, path, ext }.
  const buckets = useMemo(() => {
    if (!report || !report.missing) return null;
    const row = f => ({ name: f.name, size: f.size, path: f.path, ext: f.ext });
    return {
      missing:    report.missing.map(row),                  // source files with no copy in the backup — the risk
      unreadable: report.unreadable.map(row),               // couldn't be read — unknown
      backedUp:   report.backedUp.map(m => row(m.source)),  // source files that have a copy
      backupOnly: report.backupOnly.map(row),               // backup files not in the source — informational
    };
  }, [report]);

  const filtered = useMemo(() => {
    if (!buckets) return null;
    const q = search.trim().toLowerCase();
    if (!q) return buckets;
    const match = r => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q);
    return Object.fromEntries(Object.entries(buckets).map(([k, rows]) => [k, rows.filter(match)]));
  }, [buckets, search]);

  if (!report || !buckets) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap: scale(16), color:'var(--text-secondary)' }}>
        <p style={{ fontSize: scale(13) }}>No verification data was returned for this scan.</p>
        <button onClick={onBack} style={S.btnSecondary}>← Back to start</button>
      </div>
    );
  }

  const summary = report.summary || {};
  const missingCount = buckets.missing.length;
  const unreadSource = summary.unreadableSourceCount || 0;
  const allBackedUp = missingCount === 0 && unreadSource === 0;

  // How strong a "backed up" claim this scan can make.
  const matchedLabel = { thorough: 'Backed up', standard: 'Likely backed up', quick: 'Same name and size' }[confidence] || 'Backed up';
  const goodHeadline = {
    thorough: '✓ Every source file has a byte-for-byte identical copy in the backup.',
    standard: '✓ Every source file appears to be in the backup.',
    quick:    'Every source file has a backup file with the same name and size.',
  }[confidence];
  const strength = {
    standard: 'Matched on size and the first 64 KB of each file. Run a Thorough scan to confirm every byte — corruption later in a file would not show here.',
    quick:    'Quick match does not read file contents, so this is not proof of a backup. Run a Thorough scan before relying on it.',
  }[confidence];
  const sourcePath = (scanConfig?.protectedFolders || [])[0] || '';
  const backupPath = (scanConfig?.targetFolders || [])[0] || '';

  const Section = ({ id, title, tint, rows }) => {
    const isOpen = open[id];
    const shown = rows.slice(0, ROW_CAP);
    const overflow = rows.length - shown.length;
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: scale(12) }}>
        <button
          onClick={() => setOpen(o => ({ ...o, [id]: !o[id] }))}
          style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
                   background:'var(--bg-surface)', border:'none', cursor:'pointer',
                   padding:`${scale(10)}px ${scale(14)}px`, color:'var(--text-primary)', fontSize: scale(12), fontWeight: 600 }}
        >
          <span style={{ display:'flex', alignItems:'center', gap: scale(8) }}>
            <span style={{ width: scale(8), height: scale(8), borderRadius:'50%', background: tint }} />
            {title}
            <span style={{ color:'var(--text-muted)', fontWeight: 400 }}>({rows.length})</span>
          </span>
          <span style={{ color:'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
        </button>
        {isOpen && rows.length > 0 && (
          <div style={{ maxHeight: scale(320), overflowY:'auto', background:'var(--bg-base)' }}>
            {shown.map((r, i) => (
              <div key={r.path + i} style={{ display:'flex', alignItems:'center', gap: scale(10),
                     padding:`${scale(7)}px ${scale(14)}px`, borderTop:'1px solid var(--border)' }}>
                <span style={{ fontSize: scale(14) }}>{fileIcon(r.ext)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: scale(12), color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: scale(10), color:'var(--text-muted)', fontFamily:'var(--font-mono)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.path}</div>
                </div>
                <span style={{ fontSize: scale(11), color:'var(--text-secondary)', flexShrink: 0 }}>{formatSize(r.size)}</span>
              </div>
            ))}
            {overflow > 0 && (
              <div style={{ padding:`${scale(8)}px ${scale(14)}px`, fontSize: scale(10), color:'var(--text-muted)', borderTop:'1px solid var(--border)' }}>
                …and {overflow.toLocaleString()} more (refine with search above)
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', padding: scale(20), overflow:'hidden' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: scale(16) }}>
        <div>
          <div style={S.label}>Verify backup</div>
          <h2 style={{ fontSize: scale(18), color:'var(--text-primary)', margin:`${scale(2)}px 0 0` }}>Backup coverage report</h2>
          <div style={{ fontSize: scale(11), color:'var(--text-muted)', marginTop: scale(2) }}>
            Is every file in <strong>{sourcePath}</strong> also in <strong>{backupPath}</strong>?
          </div>
        </div>
        <button onClick={onBack} style={S.btnSecondary}>← New scan</button>
      </div>

      {/* Headline banner */}
      <div style={{
        borderRadius:'var(--radius-md)', padding:`${scale(12)}px ${scale(16)}px`, marginBottom: scale(16),
        background: allBackedUp ? 'var(--teal-dim)' : 'var(--amber-dim)',
        border: `1px solid ${allBackedUp ? 'var(--teal)' : 'var(--amber)'}`,
      }}>
        <div style={{ fontSize: scale(13), fontWeight: 600, color: allBackedUp ? 'var(--teal)' : 'var(--amber)' }}>
          {allBackedUp
            ? goodHeadline
            : missingCount > 0
              ? `⚠ ${missingCount.toLocaleString()} source file${missingCount !== 1 ? 's are' : ' is'} not in the backup.`
              : `⚠ ${unreadSource.toLocaleString()} source file${unreadSource !== 1 ? 's' : ''} couldn't be read, so ${unreadSource !== 1 ? 'they were' : 'it was'} not checked.`}
        </div>
        {missingCount > 0 && (
          <div style={{ fontSize: scale(11), color:'var(--text-secondary)', marginTop: scale(4) }}>
            No copy of these exists anywhere in the backup folder. Copy them to the backup before deleting anything from the source.
          </div>
        )}
        {missingCount > 0 && unreadSource > 0 && (
          <div style={{ fontSize: scale(11), color:'var(--text-secondary)', marginTop: scale(4) }}>
            {unreadSource.toLocaleString()} more source file{unreadSource !== 1 ? 's' : ''} couldn't be read and {unreadSource !== 1 ? 'were' : 'was'} not checked.
          </div>
        )}
        {strength && (
          <div style={{ fontSize: scale(11), color:'var(--text-secondary)', marginTop: scale(4) }}>{strength}</div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display:'flex', gap: scale(12), marginBottom: scale(16) }}>
        <div style={S.card}>
          <div style={S.label}>Missing from backup</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color: missingCount ? 'var(--amber)' : 'var(--text-secondary)' }}>{missingCount.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>{formatSize(summary.missingSize)}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>{matchedLabel}</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color:'var(--teal)' }}>{buckets.backedUp.length.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>of {(summary.totalSource || 0).toLocaleString()} source files · {formatSize(summary.backedUpSize)}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Only in backup</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color:'var(--text-secondary)' }}>{buckets.backupOnly.length.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>{formatSize(summary.backupOnlySize)}</div>
        </div>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Filter by name or path…"
        style={{ marginBottom: scale(14), padding:`${scale(8)}px ${scale(12)}px`, fontSize: scale(12),
                 background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)',
                 color:'var(--text-primary)', outline:'none' }}
      />

      {/* Sections */}
      <div style={{ flex: 1, overflowY:'auto' }}>
        <Section id="missing"    title="Missing from the backup"      tint="var(--amber)" rows={filtered.missing} />
        {buckets.unreadable.length > 0 && (
          <Section id="unreadable" title="Couldn't be read — not checked" tint="var(--danger)" rows={filtered.unreadable} />
        )}
        <Section id="backedUp"   title={`${matchedLabel} (source files)`} tint="var(--teal)" rows={filtered.backedUp} />
        <Section id="backupOnly" title="Only in the backup"           tint="var(--text-muted)" rows={filtered.backupOnly} />
      </div>
    </div>
  );
}
