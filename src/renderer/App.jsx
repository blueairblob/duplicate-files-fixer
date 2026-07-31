import React, { useState, useCallback, useEffect } from 'react';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ExclusionListPanel from './components/ExclusionListPanel.jsx';
import HomeView from './views/HomeView.jsx';
import ScanView from './views/ScanView.jsx';
import ResultsView from './views/ResultsView.jsx';
import VerifyResultsView from './views/VerifyResultsView.jsx';
import DoneView from './views/DoneView.jsx';
import RecoveryView from './views/RecoveryView.jsx';

const api = window.electronAPI;

const SECTION_TITLES = {
  scan: 'New scan',
  history: 'History',
  quarantine: 'Quarantine',
  exclusions: 'Exclusions',
  settings: 'Settings',
};

// App-level state machine: home → scanning → results/verify → done, wrapped in
// a persistent shell (title bar toolbar + collapsible source-list sidebar).
// The Quarantine sidebar section hosts RecoveryView, replacing the old
// header-button entry point on HomeView.
export default function App() {
  const [view, setView] = useState('home');
  const [section, setSection] = useState('scan');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scanConfig, setScanConfig] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [deleteResult, setDeleteResult] = useState(null);
  const [quarantineCount, setQuarantineCount] = useState(0);

  // Keep the sidebar badge in sync with the quarantine manifest. Refreshed on
  // mount and whenever a flow that can change it completes (delete / restore).
  const refreshQuarantineCount = useCallback(async () => {
    if (!api?.getQuarantineManifest) return;
    try {
      const manifest = await api.getQuarantineManifest();
      setQuarantineCount(Array.isArray(manifest) ? manifest.length : 0);
    } catch {
      /* badge is cosmetic - ignore */
    }
  }, []);

  useEffect(() => { refreshQuarantineCount(); }, [refreshQuarantineCount]);

  const handleStartScan = useCallback((config) => {
    setScanConfig(config);
    setView('scanning');
  }, []);

  const handleScanComplete = useCallback((result) => {
    setScanResult(result);
    setView(result.mode === 'verify' ? 'verify' : 'results');
  }, []);

  const handleDeleteComplete = useCallback((result) => {
    setDeleteResult(result);
    setView('done');
    refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  const handleReset = useCallback(() => {
    setView('home');
    setSection('scan');
    setScanConfig(null);
    setScanResult(null);
    setDeleteResult(null);
    refreshQuarantineCount();
  }, [refreshQuarantineCount]);

  const handleSelectSection = useCallback((id) => {
    setSection(id);
    if (id === 'scan') {
      handleReset();
    } else if (view !== 'home') {
      // Leaving the scan flow via the sidebar abandons in-progress state
      setView('home');
      setScanConfig(null);
      setScanResult(null);
      setDeleteResult(null);
    }
    if (id === 'quarantine') refreshQuarantineCount();
  }, [view, handleReset, refreshQuarantineCount]);

  const inScanFlow = view !== 'home';
  const title = inScanFlow
    ? { scanning: 'Scanning\u2026', results: 'Results', verify: 'Verify results', done: 'Done' }[view]
    : SECTION_TITLES[section];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-window)' }}>
      <TitleBar title={title} onToggleSidebar={() => setSidebarOpen(o => !o)} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {sidebarOpen && (
          <Sidebar
            section={inScanFlow ? 'scan' : section}
            onSelectSection={handleSelectSection}
            quarantineCount={quarantineCount}
          />
        )}

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {view === 'home' && section === 'scan' && (
            <HomeView onStartScan={handleStartScan} />
          )}
          {view === 'home' && section === 'quarantine' && (
            <RecoveryView onBack={() => { setSection('scan'); refreshQuarantineCount(); }} />
          )}
          {view === 'home' && section === 'exclusions' && (
            <SectionPage title="Scan exclusions" subtitle="Folders and patterns skipped by every scan.">
              <ExclusionListPanel />
            </SectionPage>
          )}
          {view === 'home' && (section === 'history' || section === 'settings') && (
            <SectionPage
              title={SECTION_TITLES[section]}
              subtitle={section === 'history'
                ? 'Past scans will appear here.'
                : 'App preferences will live here.'}
            />
          )}

          {view === 'scanning' && (
            <ScanView scanConfig={scanConfig} onComplete={handleScanComplete} onCancel={handleReset} />
          )}
          {view === 'results' && (
            <ResultsView scanResult={scanResult} scanConfig={scanConfig}
              onDeleteComplete={handleDeleteComplete} onBack={handleReset} />
          )}
          {view === 'verify' && (
            <VerifyResultsView scanResult={scanResult} scanConfig={scanConfig} onBack={handleReset} />
          )}
          {view === 'done' && (
            <DoneView deleteResult={deleteResult} onScanAgain={handleReset} />
          )}
        </div>
      </div>
    </div>
  );
}

// Simple content page used by sidebar sections that aren't the scan flow.
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
