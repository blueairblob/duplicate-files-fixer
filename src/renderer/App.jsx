import React, { useState, useCallback } from 'react';
import TitleBar from './components/TitleBar.jsx';
import HomeView from './views/HomeView.jsx';
import ScanView from './views/ScanView.jsx';
import ResultsView from './views/ResultsView.jsx';
import VerifyResultsView from './views/VerifyResultsView.jsx';
import DoneView from './views/DoneView.jsx';

// App-level state machine: home → scanning → results/verify → done
export default function App() {
  const [view, setView] = useState('home');
  const [scanConfig, setScanConfig] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [deleteResult, setDeleteResult] = useState(null);

  const handleStartScan = useCallback((config) => {
    setScanConfig(config);
    setView('scanning');
  }, []);

  const handleScanComplete = useCallback((result) => {
    setScanResult(result);
    // Verify mode has its own read-only results view
    setView(result.mode === 'verify' ? 'verify' : 'results');
  }, []);

  const handleDeleteComplete = useCallback((result) => {
    setDeleteResult(result);
    setView('done');
  }, []);

  const handleReset = useCallback(() => {
    setView('home');
    setScanConfig(null);
    setScanResult(null);
    setDeleteResult(null);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)' }}>
      <TitleBar />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'home' && (
          <HomeView onStartScan={handleStartScan} />
        )}
        {view === 'scanning' && (
          <ScanView
            scanConfig={scanConfig}
            onComplete={handleScanComplete}
            onCancel={handleReset}
          />
        )}
        {view === 'results' && (
          <ResultsView
            scanResult={scanResult}
            scanConfig={scanConfig}
            onDeleteComplete={handleDeleteComplete}
            onBack={handleReset}
          />
        )}
        {view === 'verify' && (
          <VerifyResultsView
            scanResult={scanResult}
            scanConfig={scanConfig}
            onBack={handleReset}
          />
        )}
        {view === 'done' && (
          <DoneView
            deleteResult={deleteResult}
            onScanAgain={handleReset}
          />
        )}
      </div>
    </div>
  );
}
