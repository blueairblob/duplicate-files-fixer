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
  const [open, setOpen] = useState({ unbacked: true, matched: false, nasOnly: false });

  // Normalise every bucket to a flat { name, size, path, ext } row shape so the
  // renderer doesn't have to care that matched items wrap two file records.
  const buckets = useMemo(() => {
    if (!report) return null;
    const { matched = [], nasOnly = [], desktopOnly = [] } = report;
    const row = f => ({ name: f.name, size: f.size, path: f.path, ext: f.ext });
    return {
      unbacked: desktopOnly.map(row),                       // on desktop, NOT on NAS — the risk
      matched:  matched.map(m => row(m.desktopFile || m.nasFile)), // safely backed up
      nasOnly:  nasOnly.map(row),                           // on NAS only — informational
    };
  }, [report]);

  const filtered = useMemo(() => {
    if (!buckets) return null;
    const q = search.trim().toLowerCase();
    if (!q) return buckets;
    const match = r => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q);
    return {
      unbacked: buckets.unbacked.filter(match),
      matched:  buckets.matched.filter(match),
      nasOnly:  buckets.nasOnly.filter(match),
    };
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
  const unbackedCount = buckets.unbacked.length;
  const allBackedUp = unbackedCount === 0;

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
            ? '✓ Every desktop file was found on the NAS.'
            : `⚠ ${unbackedCount.toLocaleString()} desktop file${unbackedCount !== 1 ? 's are' : ' is'} not on the NAS.`}
        </div>
        {!allBackedUp && (
          <div style={{ fontSize: scale(11), color:'var(--text-secondary)', marginTop: scale(4) }}>
            These exist on your desktop/target but have no matching copy in the protected NAS folder — back them up before deleting anything.
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display:'flex', gap: scale(12), marginBottom: scale(16) }}>
        <div style={S.card}>
          <div style={S.label}>Backed up</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color:'var(--teal)' }}>{buckets.matched.length.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>{formatSize(summary.matchedSize)}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Not on NAS</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color: unbackedCount ? 'var(--amber)' : 'var(--text-secondary)' }}>{unbackedCount.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>{formatSize(summary.desktopOnlySize)}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Only on NAS</div>
          <div style={{ fontSize: scale(22), fontWeight: 700, color:'var(--text-secondary)' }}>{buckets.nasOnly.length.toLocaleString()}</div>
          <div style={{ fontSize: scale(10), color:'var(--text-muted)' }}>{formatSize(summary.nasOnlySize)}</div>
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
        <Section id="unbacked" title="Not on NAS (not backed up)" tint="var(--amber)" rows={filtered.unbacked} />
        <Section id="matched"  title="Backed up (on both)"        tint="var(--teal)"  rows={filtered.matched} />
        <Section id="nasOnly"  title="Only on NAS"                tint="var(--text-muted)" rows={filtered.nasOnly} />
      </div>
    </div>
  );
}
