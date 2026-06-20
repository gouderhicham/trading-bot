import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { INSTRUMENTS, TIMEFRAMES, formatPrice } from '../services/marketData';

const CATEGORIES = ['Forex', 'Metals', 'Crypto'];

export default function ScannerMonitor({ prices = {}, changes = {}, rsi = {}, scanStatus }) {
  const isActive = Boolean(scanStatus?.symbol);

  const byCategory = useMemo(
    () => CATEGORIES.map(cat => ({ cat, items: INSTRUMENTS.filter(i => i.category === cat) })),
    [],
  );

  return (
    <div className="scanner-monitor">

      {/* ── Active scan status bar ───────────────────────────── */}
      <div className={`scan-header ${isActive ? 'scan-header-live' : ''}`}>
        <div className="scan-led-wrap">
          <div className={`scan-led ${isActive ? 'scan-led-on' : 'scan-led-off'}`} />
          {isActive ? (
            <span className="scan-live-text">
              {scanStatus.status === 'scanning' ? '🔍 Scanning' : '🧠 Analyzing'}{' '}
              <strong>{scanStatus.symbol}</strong>
              <span className="scan-tf"> · {scanStatus.timeframe}</span>
            </span>
          ) : (
            <span className="scan-idle-text">Monitoring markets · idle</span>
          )}
        </div>

        {/* Timeframe chips */}
        <div className="tf-chips">
          {TIMEFRAMES.map(tf => (
            <span
              key={tf}
              className={`tf-chip ${isActive && scanStatus.timeframe === tf ? 'tf-chip-on' : ''}`}
            >
              {tf}
            </span>
          ))}
        </div>
      </div>

      {/* ── Instrument rows ──────────────────────────────────── */}
      <div className="inst-list">
        {byCategory.map(({ cat, items }) => (
          <div key={cat}>
            <div className="inst-cat-header">{cat}</div>
            {items.map(inst => {
              const p      = prices[inst.symbol];
              const chg    = changes[inst.symbol];
              const rsiVal = rsi[inst.symbol];
              const active = isActive && scanStatus.symbol === inst.label;

              return (
                <motion.div
                  key={inst.symbol}
                  className={`inst-row ${active ? 'inst-row-live' : ''}`}
                  animate={{ opacity: 1 }}
                  initial={{ opacity: 0.85 }}
                >
                  <span className="inst-icon">{inst.icon}</span>
                  <span className="inst-name">{inst.label}</span>

                  <span className="inst-price">
                    {p != null ? formatPrice(inst.symbol, p) : <span className="price-dash">—</span>}
                  </span>

                  {chg != null ? (
                    <span className={`inst-chg ${chg >= 0 ? 'chg-pos' : 'chg-neg'}`}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="inst-chg price-dash">—</span>
                  )}

                  <span
                    className={`inst-rsi ${
                      rsiVal == null ? 'price-dash' :
                      rsiVal < 30    ? 'rsi-os'     :
                      rsiVal > 70    ? 'rsi-ob'     : ''
                    }`}
                  >
                    {rsiVal != null ? rsiVal : '—'}
                  </span>

                  {active && <span className="inst-scan-pulse" />}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
