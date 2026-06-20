import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './services/firebase';
import BotEngine      from './components/BotEngine';
import MarketScanner  from './components/MarketScanner';
import ScannerMonitor from './components/ScannerMonitor';
import LivePipeline   from './components/LivePipeline';
import StatsBar       from './components/StatsBar';
import SignalCard      from './components/SignalCard';
import TradeJournal   from './components/TradeJournal';
import Analytics      from './components/Analytics';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Terminal, Brain, BookOpen, BarChart2, Radio, Zap } from 'lucide-react';
import './index.css';

const TABS = [
  { id: 'signals',   label: 'Signals',   icon: Brain    },
  { id: 'journal',   label: 'Journal',   icon: BookOpen },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
];

export default function App() {
  const [activeTab,  setActiveTab]  = useState('signals');
  const [rightTab,   setRightTab]   = useState('monitor');   // 'monitor' | 'pipeline'
  const [analyses,   setAnalyses]   = useState([]);
  const [logs,       setLogs]       = useState([]);
  const [pipeline,   setPipeline]   = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [marketData, setMarketData] = useState({ prices: {}, changes: {}, rsi: {} });

  const addLog = useCallback((message) => {
    setLogs(prev =>
      [{ id: Date.now() + Math.random(), time: new Date(), message }, ...prev].slice(0, 300),
    );
  }, []);

  const handlePipeline = useCallback((data) => {
    setPipeline(data);
    // Auto-switch to pipeline tab when a new analysis starts
    if (data?.stage === 'received') setRightTab('pipeline');
    // Return to monitor 3s after pipeline clears
    if (!data) setTimeout(() => setRightTab('monitor'), 3_000);
  }, []);

  const handlePricesUpdate = useCallback((data) => setMarketData(data), []);
  const handleScanStatus   = useCallback((s)    => setScanStatus(s),    []);

  useEffect(() => {
    const q = query(collection(db, 'analysis'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, snap => {
      setAnalyses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const isScanning = Boolean(scanStatus?.symbol);
  const hasPipeline = Boolean(pipeline);

  return (
    <div className="app-root">
      <BotEngine     onLog={addLog} onPipelineUpdate={handlePipeline} />
      <MarketScanner onLog={addLog} onPricesUpdate={handlePricesUpdate} onScanStatus={handleScanStatus} />

      {/* ── Navbar ──────────────────────────────────────────── */}
      <nav className="navbar">
        <div className="nav-brand">
          <Activity className="brand-icon pulse" size={22} />
          <h1>Nexus TradeBot</h1>
        </div>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
        <div className={`nav-status ${hasPipeline ? 'status-analyzing' : isScanning ? 'status-scanning' : ''}`}>
          <div className="status-dot" />
          <span>
            {hasPipeline
              ? pipeline.stage === 'gemini'
                ? `Gemini → ${pipeline.alert?.symbol}`
                : pipeline.stage === 'done'
                  ? `Done: ${pipeline.alert?.symbol}`
                  : `Analyzing ${pipeline.alert?.symbol}`
              : isScanning
                ? `Scanning ${scanStatus.symbol}`
                : 'Engine Online'
            }
          </span>
        </div>
      </nav>

      {/* ── Stats bar ───────────────────────────────────────── */}
      <StatsBar analyses={analyses} />

      {/* ── Tab content ─────────────────────────────────────── */}
      <main className="main-content">
        {activeTab === 'signals' && (
          <div className="signals-layout">

            {/* Signal feed */}
            <section className="panel feed-panel">
              <div className="panel-header">
                <Brain size={18} />
                <h2>Signal Feed</h2>
                <span className="panel-count">{analyses.filter(a => a.riskPassed).length}</span>
              </div>
              <div className="feed-scroll">
                {analyses.length === 0 && (
                  <div className="empty-state">
                    <span className="empty-icon">📡</span>
                    <p>Scanner running — signals appear here</p>
                    <small>Auto-scanner active in background</small>
                  </div>
                )}
                <AnimatePresence>
                  {analyses.filter(a => a.riskPassed).map(item => (
                    <SignalCard key={item.id} item={item} />
                  ))}
                </AnimatePresence>
              </div>
            </section>

            {/* ── Right column ──────────────────────────────── */}
            <div className="right-column">

              {/* Top panel: Monitor ↔ Pipeline tabs */}
              <section className="panel right-top-panel">
                <div className="panel-header rtab-header">
                  <button
                    className={`rtab ${rightTab === 'monitor' ? 'rtab-active' : ''}`}
                    onClick={() => setRightTab('monitor')}
                  >
                    <Radio size={13} /> Monitor
                  </button>
                  <button
                    className={`rtab ${rightTab === 'pipeline' ? 'rtab-active' : ''}`}
                    onClick={() => setRightTab('pipeline')}
                  >
                    <Zap size={13} /> Pipeline
                    {hasPipeline && <span className="rtab-live-dot" />}
                  </button>

                  {rightTab === 'monitor' && isScanning && (
                    <span className="panel-live-badge">LIVE</span>
                  )}
                  {rightTab === 'pipeline' && hasPipeline && (
                    <span className="panel-live-badge">
                      {pipeline.stage === 'gemini' ? 'THINKING' :
                       pipeline.stage === 'done'   ? 'DONE' : 'RUNNING'}
                    </span>
                  )}
                </div>

                {rightTab === 'monitor' ? (
                  <ScannerMonitor
                    prices={marketData.prices}
                    changes={marketData.changes}
                    rsi={marketData.rsi}
                    scanStatus={scanStatus}
                  />
                ) : (
                  <LivePipeline pipeline={pipeline} />
                )}
              </section>

              {/* Activity log */}
              <section className="panel terminal-panel">
                <div className="panel-header">
                  <Terminal size={18} />
                  <h2>Activity Log</h2>
                  {logs.length > 0 && (
                    <button className="clear-btn" onClick={() => setLogs([])}>Clear</button>
                  )}
                </div>
                <div className="logs-scroll">
                  {logs.length === 0 && <p className="log-muted">Initializing...</p>}
                  <AnimatePresence>
                    {logs.map(l => (
                      <motion.div
                        key={l.id}
                        className="log-line"
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                      >
                        <span className="log-ts">[{l.time.toLocaleTimeString()}]</span>
                        <span className="log-msg">{l.message}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>

            </div>
          </div>
        )}

        {activeTab === 'journal' && (
          <div className="tab-content">
            <TradeJournal analyses={analyses} />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="tab-content">
            <Analytics analyses={analyses} />
          </div>
        )}
      </main>
    </div>
  );
}
