import React, { useState, useCallback, useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ExclusionListPanel from './components/ExclusionListPanel.jsx';
import HomeView from './views/HomeView.jsx';
import ScanView from './views/ScanView.jsx';
import ResultsView from './views/ResultsView.jsx';
import CompareView from './views/CompareView.jsx';
import VerifyResultsView from './views/VerifyResultsView.jsx';
import DoneView from './views/DoneView.jsx';
import RecoveryView from './views/RecoveryView.jsx';
import HistoryView from './views/HistoryView.jsx';
import SettingsView from './views/SettingsView.jsx';
import { initTheme } from './utils/theme.js';
import { loadHistory, addHistoryEntry, updateHistoryEntry, removeHistoryEntry, clearHistory, entryTitle, entrySubtitle } from './utils/scanHistory.js';

const api = window.electronAPI;

const SECTION_TITLES = {
  scan: 'New scan',
  history: 'History',
  quarantine: 'Quarantine',
  exclusions: 'Exclusions',
  settings: 'Settings',
};

// The scan lifecycle is owned HERE, not by ScanView. The worker runs in the
// main process regardless of what the renderer shows, so the user can navigate
// anywhere mid-scan; the sidebar's activity item is the way back. ScanView is
// just a window onto `scan.progress`.
export default function App() {
  const [view, setView] = useState('home');           // what is displayed
  const [showAllFiles, setShowAllFiles] = useState(false); // Compare summary -> full file list
  const [fileSelection, setFileSelection] = useState(null); // paths chosen by folder on Compare
  const [section, setSection] = useState('scan');     // which sidebar page when view === 'home'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scan, setScan] = useState(null);             // { status, config, progress, startedAt, result? }
  const [cancelling, setCancelling] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  const [preset, setPreset] = useState(null);

  // Refs so async completion callbacks see current values
  const viewRef = useRef(view);   viewRef.current = view;
  const runIdRef = useRef(0);     // invalidates stale completions after cancel/new scan
  const demoTimerRef = useRef(null);
  const historyIdRef = useRef(null); // history entry for the current run

  const refreshQuarantineCount = useCallback(async () => {
    if (!api?.getQuarantineManifest) return;
    try {
      const manifest = await api.getQuarantineManifest();
      setQuarantineCount(Array.isArray(manifest) ? manifest.length : 0);
    } catch { /* badge is cosmetic */ }
  }, []);

  useEffect(() => {
    initTheme();
    refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  // ── Scan controller ─────────────────────────────────────────────────────────
  const completeScan = useCallback((runId, config, result) => {
    if (runId !== runIdRef.current) return; // cancelled or superseded
    setScan(s => (s && s.status === 'running' ? { ...s, status: 'complete', result } : s));
    if (historyIdRef.current) setHistory(updateHistoryEntry(historyIdRef.current, result));
    // Only yank the user to results if they're actually watching the scan
    if (viewRef.current === 'scanning') {
      setView(result.mode === 'verify' ? 'verify' : 'results');
    }
  }, []);

  const handleStartScan = useCallback(async (config) => {
    // Supersede any existing scan
    runIdRef.current += 1;
    const runId = runIdRef.current;
    if (demoTimerRef.current) { clearInterval(demoTimerRef.current); demoTimerRef.current = null; }
    if (api && scan?.status === 'running') { try { await api.cancelScan(); } catch { /* ignore */ } }

    setCancelling(false);
    setDeleteResult(null);
    // Record the attempt immediately — an abandoned scan should be one click
    // away in Recents/History.
    {
      const { list, id } = addHistoryEntry(config);
      setHistory(list);
      historyIdRef.current = id;
    }
    setScan({
      status: 'running', config, startedAt: Date.now(),
      progress: { scanned: 0, phase: 'walking', total: 0, currentPath: '' },
    });
    setShowAllFiles(false);
    setFileSelection(null);
    setView('scanning');
    setSection('scan');

    if (!api) {
      // Demo mode (no Electron): simulate progress then complete
      let n = 0;
      demoTimerRef.current = setInterval(() => {
        n += Math.floor(Math.random() * 20) + 5;
        setScan(s => s && s.status === 'running'
          ? { ...s, progress: { ...s.progress, scanned: n, ...(n > 150 ? { phase: 'hashing', total: 400 } : {}) } }
          : s);
        if (n >= 400) {
          clearInterval(demoTimerRef.current); demoTimerRef.current = null;
          completeScan(runId, config, {
            groups: generateDemoGroups(config.mode), emptyFiles: [],
            totalScanned: n, totalHashed: 120, warnings: [], mode: config.mode,
          });
        }
      }, 100);
      return;
    }

    api.removeScanProgress();
    api.onScanProgress(({ scanned, phase, total, currentPath }) => {
      if (runId !== runIdRef.current) return;
      setScan(s => {
        if (!s || s.status !== 'running') return s;
        const p = { ...s.progress };
        if (typeof scanned === 'number') p.scanned = scanned;
        if (phase) p.phase = phase;
        if (typeof total === 'number' && total > 0) p.total = total;
        if (currentPath) p.currentPath = currentPath;
        return { ...s, progress: p };
      });
    });

    api.startScan(config)
      .then(result => {
        api.removeScanProgress();
        completeScan(runId, config, result);
      })
      .catch(err => {
        api.removeScanProgress();
        completeScan(runId, config, {
          groups: [], emptyFiles: [], totalScanned: 0, totalHashed: 0,
          warnings: [{ path: '-', reason: err.message }], mode: config.mode, error: err.message,
        });
      });
  }, [scan, completeScan]);

  const handleCancelScan = useCallback(async () => {
    runIdRef.current += 1; // invalidate in-flight completion
    if (demoTimerRef.current) { clearInterval(demoTimerRef.current); demoTimerRef.current = null; }
    setCancelling(true);
    if (api) { try { await api.cancelScan(); api.removeScanProgress(); } catch { /* ignore */ } }
    setCancelling(false);
    setScan(null);
    setView('home');
    setSection('scan');
  }, []);

  // ── Post-scan flows ─────────────────────────────────────────────────────────
  const handleDeleteComplete = useCallback((result) => {
    setDeleteResult(result);
    setView('done');
    refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  const handleReset = useCallback(() => {
    setShowAllFiles(false);
    setFileSelection(null);
    runIdRef.current += 1;
    if (demoTimerRef.current) { clearInterval(demoTimerRef.current); demoTimerRef.current = null; }
    setScan(null);
    setDeleteResult(null);
    setView('home');
    setSection('scan');
    refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  const handleLoadEntry = useCallback((entry) => {
    setPreset({
      key: `${entry.id}-${Date.now()}`,
      mode: entry.mode,
      protectedFolders: entry.protectedFolders,
      targetFolders: entry.targetFolders,
      confidence: entry.confidence,
    });
    setView('home');
    setSection('scan');
  }, []);

  // Navigation NEVER touches the scan — it only changes what's displayed.
  const handleSelectSection = useCallback((id) => {
    setSection(id);
    setView('home');
    if (id === 'quarantine') refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  const openScanActivity = useCallback(() => {
    if (!scan) return;
    if (scan.status === 'running') setView('scanning');
    else setView(scan.result?.mode === 'verify' ? 'verify' : 'results');
  }, [scan]);

  // ── Derived display state ───────────────────────────────────────────────────
  const inScanFlow = view !== 'home';
  const title = inScanFlow
    ? (view === 'results'
        ? (scan?.result?.census && !showAllFiles ? 'Compare' : 'Duplicate files')
        : { scanning: 'Scanning\u2026', verify: 'Verify results', done: 'Done' }[view])
    : SECTION_TITLES[section];

  const scanActivity = scan ? (
    scan.status === 'running'
      ? {
          status: 'running',
          pct: scan.progress.total > 0 && scan.progress.phase !== 'walking'
            ? Math.min(99, Math.round((scan.progress.scanned / scan.progress.total) * 100))
            : null,
        }
      : { status: 'complete', groups: Array.isArray(scan.result?.groups) ? scan.result.groups.length : null }
  ) : null;

  const sidebarActive = inScanFlow ? 'activity' : section;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-window)' }}>
      <TitleBar title={title} onToggleSidebar={() => setSidebarOpen(o => !o)} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {sidebarOpen && (
          <Sidebar
            section={sidebarActive}
            onSelectSection={handleSelectSection}
            quarantineCount={quarantineCount}
            recentScans={history.slice(0, 3).map(e => ({ id: e.id, title: entryTitle(e), subtitle: entrySubtitle(e), entry: e }))}
            onSelectRecent={handleLoadEntry}
            scanActivity={scanActivity}
            onSelectActivity={openScanActivity}
          />
        )}

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {view === 'home' && section === 'scan' && (
            <HomeView onStartScan={handleStartScan} preset={preset} />
          )}
          {view === 'home' && section === 'quarantine' && (
            <RecoveryView onBack={() => { setSection('scan'); refreshQuarantineCount(); }} />
          )}
          {view === 'home' && section === 'exclusions' && (
            <SectionPage title="Scan exclusions" subtitle="Folders and patterns skipped by every scan.">
              <ExclusionListPanel />
            </SectionPage>
          )}
          {view === 'home' && section === 'history' && (
            <HistoryView
              entries={history}
              onLoadEntry={handleLoadEntry}
              onRemoveEntry={(id) => setHistory(removeHistoryEntry(id))}
              onClearAll={() => setHistory(clearHistory())}
            />
          )}
          {view === 'home' && section === 'settings' && <SettingsView />}

          {view === 'scanning' && scan && (
            <ScanView
              scanConfig={scan.config}
              progress={scan.progress}
              startedAt={scan.startedAt}
              cancelling={cancelling}
              onCancel={handleCancelScan}
            />
          )}
          {view === 'results' && scan?.result && scan.result.census && !showAllFiles && (
            <CompareView scanResult={scan.result} scanConfig={scan.config}
              onReviewFiles={(paths) => { setFileSelection(paths || null); setShowAllFiles(true); }} onBack={handleReset} />
          )}
          {view === 'results' && scan?.result && (!scan.result.census || showAllFiles) && (
            <ResultsView scanResult={scan.result} scanConfig={scan.config}
              onDeleteComplete={handleDeleteComplete}
              selection={fileSelection}
              backLabel={scan.result.census ? 'Compare' : null}
              onBack={scan.result.census ? () => { setShowAllFiles(false); setFileSelection(null); } : handleReset} />
          )}
          {view === 'verify' && scan?.result && (
            <VerifyResultsView scanResult={scan.result} scanConfig={scan.config} onBack={handleReset} />
          )}
          {view === 'done' && (
            <DoneView deleteResult={deleteResult} onScanAgain={handleReset} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionPage({ title, subtitle, children }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '28px 32px' }}>
        <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 500, marginBottom: 4 }}>{title}</h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', marginBottom: 24 }}>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function generateDemoGroups(mode) {
  const exts = ['.jpg', '.mp3', '.pdf', '.docx', '.mp4', '.png'];
  return Array.from({ length: 10 }, (_, i) => {
    const ext  = exts[i % exts.length];
    const size = Math.floor(Math.random() * 5000000) + 50000;
    const count = Math.floor(Math.random() * 2) + 2;
    const hasProtected = mode === 'compare' && i % 3 !== 0;
    const files = Array.from({ length: count }, (_, j) => ({
      path: j === 0 && hasProtected
        ? `C:\\Backup\\protected_file_${i}${ext}`
        : `C:\\Users\\Demo\\Downloads\\file_${i}_copy${j}${ext}`,
      name: j === 0 && hasProtected ? `protected_file_${i}${ext}` : `file_${i}_copy${j}${ext}`,
      size,
      modified: new Date(Date.now() - j * 86400000 * 3).toISOString(),
      ext,
      sourceLabel: j === 0 && hasProtected ? 'protected' : 'target',
    }));
    const autoMarked = files.filter(f => f.sourceLabel === 'target').slice(hasProtected ? 0 : 1).map(f => f.path);
    return { id: i, hash: `demo_${i}`, files, autoMarked, hasProtected };
  });
}
