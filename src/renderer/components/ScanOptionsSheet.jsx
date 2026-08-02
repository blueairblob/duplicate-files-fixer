import React from 'react';
import { useDPR } from '../contexts/DPRContext.jsx';
import { XIcon, CheckCircleIcon } from './icons.jsx';

const FILE_TYPES = [
  { id: 'photos',   label: 'Photos' },
  { id: 'audio',    label: 'Audio' },
  { id: 'video',    label: 'Video' },
  { id: 'docs',     label: 'Documents' },
  { id: 'archives', label: 'Archives' },
];

const SIZE_OPTIONS = [
  { label: 'Any size',  value: 0 },
  { label: '> 100 KB', value: 102400 },
  { label: '> 1 MB',   value: 1048576 },
  { label: '> 10 MB',  value: 10485760 },
  { label: '> 100 MB', value: 104857600 },
];

// Plain-language framing of the auto-mark rules. IDs match the scan engine.
const KEEP_RULES = [
  { id: 'protected-wins', label: 'The protected copy', recommended: true },
  { id: 'keep-newest',    label: 'The newest copy' },
  { id: 'keep-oldest',    label: 'The oldest copy' },
  { id: 'keep-largest',   label: 'The largest copy' },
];

export default function ScanOptionsSheet({
  mode, types, onToggleType, minSize, onMinSize,
  confidence, onConfidence,
  includeEmpty, onIncludeEmpty, autoMarkRule, onAutoMarkRule,
  onReset, onClose,
}) {
  const { scale } = useDPR();

  const sectionTitle = {
    fontSize: 'var(--fs-secondary)', fontWeight: 500,
    color: 'var(--text-primary)', margin: `0 0 ${scale(8)}px`,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: scale(440), maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sheet)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: `${scale(14)}px ${scale(18)}px`,
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-heading)', fontWeight: 500 }}>Scan options</span>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex' }}>
            <XIcon size={scale(16)} />
          </button>
        </div>

        <div style={{ padding: scale(18) }}>

          {mode === 'compare' && (
            <>
              <p style={sectionTitle}>When duplicates are found, keep</p>
              <div style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                overflow: 'hidden', marginBottom: scale(20),
              }}>
                {KEEP_RULES.map(({ id, label, recommended }, i) => {
                  const active = autoMarkRule === id;
                  return (
                    <button key={id} onClick={() => onAutoMarkRule(id)} style={{
                      display: 'flex', alignItems: 'center', gap: scale(10), width: '100%',
                      padding: `${scale(10)}px ${scale(14)}px`, textAlign: 'left',
                      background: active ? 'var(--accent-tint)' : 'transparent',
                      borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                    }}>
                      {active
                        ? <CheckCircleIcon size={scale(16)} color="var(--accent)" />
                        : <span style={{
                            width: scale(16), height: scale(16), borderRadius: '50%',
                            border: '1.5px solid var(--border-strong)', flexShrink: 0,
                          }} />}
                      <span style={{
                        flex: 1, fontSize: 'var(--fs-secondary)',
                        fontWeight: active ? 500 : 400,
                        color: active ? 'var(--accent)' : 'var(--text-primary)',
                      }}>{label}</span>
                      {recommended && (
                        <span style={{ fontSize: 'var(--fs-caption)', color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                          Recommended
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <p style={sectionTitle}>Match confidence</p>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            overflow: 'hidden', marginBottom: scale(20),
          }}>
            {[
              { id: 'quick',    label: 'Quick',    hint: 'Size and name only — fastest, for backup checks' },
              { id: 'standard', label: 'Standard', hint: 'Content sample; deletions verified first', recommended: true },
              { id: 'thorough', label: 'Thorough', hint: 'Full byte-for-byte comparison during scan' },
            ].map(({ id, label, hint, recommended }, i) => {
              const active = confidence === id;
              return (
                <button key={id} onClick={() => onConfidence(id)} style={{
                  display: 'flex', alignItems: 'center', gap: scale(10), width: '100%',
                  padding: `${scale(10)}px ${scale(14)}px`, textAlign: 'left',
                  background: active ? 'var(--accent-tint)' : 'transparent',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}>
                  {active
                    ? <CheckCircleIcon size={scale(16)} color="var(--accent)" />
                    : <span style={{
                        width: scale(16), height: scale(16), borderRadius: '50%',
                        border: '1.5px solid var(--border-strong)', flexShrink: 0,
                      }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 'var(--fs-secondary)',
                      fontWeight: active ? 500 : 400,
                      color: active ? 'var(--accent)' : 'var(--text-primary)',
                    }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {hint}
                    </span>
                  </span>
                  {recommended && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
                      Recommended
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p style={sectionTitle}>File types</p>
          <div style={{ display: 'flex', gap: scale(6), flexWrap: 'wrap', marginBottom: scale(20) }}>
            {/* "All" = empty types array, matching the scan engine's semantics */}
            <Chip active={types.length === 0} onClick={() => types.forEach(t => onToggleType(t))} scale={scale}>
              All
            </Chip>
            {FILE_TYPES.map(({ id, label }) => (
              <Chip key={id} active={types.includes(id)} onClick={() => onToggleType(id)} scale={scale}>
                {label}
              </Chip>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: scale(12), marginBottom: scale(14) }}>
            <span style={{ flex: 1, fontSize: 'var(--fs-secondary)' }}>Minimum file size</span>
            <select value={minSize} onChange={e => onMinSize(Number(e.target.value))} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
              padding: `${scale(6)}px ${scale(10)}px`, fontSize: 'var(--fs-secondary)',
            }}>
              {SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: scale(12), marginBottom: scale(20) }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 'var(--fs-secondary)', margin: 0 }}>Include empty files</p>
              <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', margin: `${scale(1)}px 0 0` }}>
                Grouped separately by name
              </p>
            </div>
            <Toggle checked={includeEmpty} onChange={onIncludeEmpty} scale={scale} />
          </div>

          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: scale(10),
            borderTop: '1px solid var(--border)', paddingTop: scale(14),
          }}>
            <button onClick={onReset} style={{
              background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
              padding: `${scale(7)}px ${scale(14)}px`, fontSize: 'var(--fs-secondary)',
            }}>Reset to defaults</button>
            <button onClick={onClose} style={{
              background: 'var(--accent)', color: 'var(--on-accent)',
              borderRadius: 'var(--radius-sm)', fontWeight: 500,
              padding: `${scale(7)}px ${scale(18)}px`, fontSize: 'var(--fs-secondary)',
            }}>Done</button>
          </div>

        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, scale, children }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 'var(--fs-caption)', fontWeight: active ? 500 : 400,
      padding: `${scale(5)}px ${scale(12)}px`, borderRadius: scale(14),
      border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
      background: active ? 'var(--accent-tint)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
    }}>{children}</button>
  );
}

function Toggle({ checked, onChange, scale }) {
  return (
    <button onClick={() => onChange(!checked)} role="switch" aria-checked={checked} style={{
      width: scale(38), height: scale(22), borderRadius: scale(11), position: 'relative',
      background: checked ? 'var(--accent)' : 'var(--border-strong)',
      transition: 'background 0.15s ease', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: scale(2),
        left: checked ? scale(18) : scale(2),
        width: scale(18), height: scale(18), borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
      }} />
    </button>
  );
}
