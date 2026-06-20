import { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { motion } from 'framer-motion';

const STRATEGY_META = {
  scalping:      { label: 'SCALPING',    color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',   border: 'rgba(6,182,212,0.3)'  },
  day_trading:   { label: 'DAY TRADING', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)',  border: 'rgba(139,92,246,0.3)' },
  swing_trading: { label: 'SWING',       color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)' },
};

// Live countdown to signal expiry
function useCountdown(createdAtTs, expiryMinutes) {
  const [msLeft, setMsLeft] = useState(null);
  useEffect(() => {
    if (!createdAtTs || !expiryMinutes) return;
    const expiresAt = createdAtTs + expiryMinutes * 60_000;
    const tick = () => setMsLeft(expiresAt - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAtTs, expiryMinutes]);
  return msLeft;
}

function fmtCountdown(ms) {
  if (ms == null) return '—';
  if (ms <= 0)    return 'EXPIRED';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ConfBar({ label, value }) {
  const pct = value ?? 0;
  const color = pct >= 75 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="sc-conf-row">
      <span className="sc-conf-label">{label}</span>
      <div className="sc-conf-track">
        <div className="sc-conf-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sc-conf-val" style={{ color }}>{pct}%</span>
    </div>
  );
}

function PriceCol({ label, price, pips, colorClass, sub }) {
  return (
    <div className="sc-price-col">
      <span className="sc-price-label">{label}</span>
      <span className={`sc-price-val ${colorClass}`}>{price ?? '—'}</span>
      {pips != null && <span className="sc-price-pips">{pips > 0 ? '+' : ''}{pips}p</span>}
      {sub  != null && <span className="sc-price-sub">{sub}</span>}
    </div>
  );
}

function OutcomeForm({ analysisId, onClose }) {
  const [outcome, setOutcome] = useState('win');
  const [pnl,     setPnl]    = useState('');
  const [note,    setNote]   = useState('');
  const [saving,  setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updateDoc(doc(db, 'analysis', analysisId), {
      outcome,
      pnl:         pnl ? parseFloat(pnl) : null,
      outcomeNote: note || null,
      closedAt:    serverTimestamp(),
    });
    onClose();
  }

  return (
    <div className="outcome-form">
      <div className="outcome-buttons">
        {['win', 'loss', 'breakeven'].map(o => (
          <button key={o} className={`outcome-btn outcome-${o} ${outcome === o ? 'active' : ''}`} onClick={() => setOutcome(o)}>
            {o === 'win' ? '✅' : o === 'loss' ? '❌' : '➖'} {o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
      <div className="outcome-inputs">
        <input type="number" placeholder="P&L (optional)" value={pnl}  onChange={e => setPnl(e.target.value)}  className="outcome-input" />
        <input type="text"   placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="outcome-input" />
      </div>
      <div className="outcome-actions">
        <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Outcome'}</button>
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function SignalCard({ item }) {
  const [expanded,        setExpanded]        = useState(false);
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);

  const a        = item.analysis || {};
  const strategy = a.strategy || item.strategy || 'day_trading';
  const smeta    = STRATEGY_META[strategy] || STRATEGY_META.day_trading;

  const direction = (a.direction || item.signal || '').toUpperCase();
  const isLong    = direction === 'LONG';
  const isShort   = direction === 'SHORT';
  const dirLabel  = isLong ? 'BUY' : isShort ? 'SELL' : direction;
  const dirColor  = isLong ? '#10b981' : isShort ? '#ef4444' : '#64748b';

  const tf       = a.recommended_timeframe || (item.timeframe ? `${item.timeframe}m` : '—');
  const riskColor = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' }[a.risk_rating] || '#64748b';

  const createdMs = item.createdAt?.toDate?.()?.getTime() ?? null;
  const msLeft    = useCountdown(createdMs, a.signal_expiry_minutes);
  const countdown = fmtCountdown(msLeft);
  const isExpired = msLeft !== null && msLeft <= 0;

  const ts = item.createdAt?.toDate?.() ?? null;
  const timeStr = ts?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '—';

  const cb = a.confidence_breakdown;

  const entry   = a.entry?.price;
  const sl      = a.stop_loss?.price;
  const slPips  = a.stop_loss?.pips;
  const tp      = a.take_profits || [];
  const tp1     = tp[0];
  const tp2     = tp[1];
  const tp3     = tp[2];

  return (
    <motion.div
      className={`signal-card signal-v2 ${isLong ? 'sv2-long' : isShort ? 'sv2-short' : ''} ${isExpired ? 'sv2-expired' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ borderLeftColor: dirColor }}
    >
      {/* ── Header row ───────────────────────────────────────── */}
      <div className="sv2-header">
        <div className="sv2-header-left">
          <span className="sv2-strategy-tag" style={{ color: smeta.color, background: smeta.bg, borderColor: smeta.border }}>
            {smeta.label}
          </span>
          <span className="sv2-symbol">{item.symbol}</span>
          <span className="sv2-tf-badge">{tf}</span>
        </div>
        <div className="sv2-header-right">
          <span className="sv2-dir-badge" style={{ color: dirColor, background: `${dirColor}18`, borderColor: `${dirColor}44` }}>
            {isLong ? '▲' : isShort ? '▼' : '●'} {dirLabel}
          </span>
          <span className="sv2-time">{timeStr}</span>
        </div>
      </div>

      {/* ── Price grid: Entry · SL · TP1 · TP2 · TP3 ────────── */}
      <div className="sv2-prices">
        <PriceCol label="ENTRY"    price={entry}    colorClass="price-cyan"  />
        <PriceCol label="STOP"     price={sl}       pips={slPips ? -slPips : null} colorClass="price-red"  />
        <PriceCol label="TP 1"     price={tp1?.price} pips={tp1?.pips} colorClass="price-green" sub="50%" />
        <PriceCol label="TP 2"     price={tp2?.price} pips={tp2?.pips} colorClass="price-green" sub="30%" />
        <PriceCol label="TP 3"     price={tp3?.price} pips={tp3?.pips} colorClass="price-green" sub="20%" />
      </div>

      {/* ── Stats row ────────────────────────────────────────── */}
      <div className="sv2-stats">
        <div className="sv2-stat">
          <span className="sv2-stat-label">CONFIDENCE</span>
          <span className="sv2-stat-val" style={{ color: a.confidence >= 75 ? '#10b981' : '#f59e0b' }}>
            {a.confidence ?? '—'}%
          </span>
        </div>
        <div className="sv2-stat">
          <span className="sv2-stat-label">R : R</span>
          <span className="sv2-stat-val" style={{ color: '#06b6d4' }}>
            1 : {a.risk_reward ?? '—'}
          </span>
        </div>
        <div className="sv2-stat">
          <span className="sv2-stat-label">RISK</span>
          <span className="sv2-stat-val" style={{ color: riskColor }}>
            {(a.risk_rating || '—').toUpperCase()}
          </span>
        </div>
        <div className="sv2-stat">
          <span className="sv2-stat-label">EXPIRES</span>
          <span className={`sv2-stat-val ${isExpired ? 'expired-txt' : ''}`}>
            {countdown}
          </span>
        </div>
      </div>

      {/* ── Confidence breakdown ──────────────────────────────── */}
      {cb && (
        <div className="sv2-breakdown">
          <ConfBar label="Trend Analysis"   value={cb.trend_analysis}   />
          <ConfBar label="Volume Analysis"  value={cb.volume_analysis}  />
          <ConfBar label="Momentum"         value={cb.momentum}         />
          <ConfBar label="Market Structure" value={cb.market_structure} />
        </div>
      )}

      {/* ── MTF confluence note ───────────────────────────────── */}
      {a.mtf_confluence && (
        <div className="sv2-mtf">
          <span className="sv2-mtf-icon">⚡</span>
          <span>{a.mtf_confluence}</span>
        </div>
      )}

      {/* ── Summary ──────────────────────────────────────────── */}
      {a.summary && <p className="sv2-summary">{a.summary}</p>}

      {/* ── Trade management (expandable) ────────────────────── */}
      {(a.trade_management || a.position_sizing || a.reasoning) && (
        <>
          <button className="expand-btn" onClick={() => setExpanded(v => !v)}>
            {expanded ? '▲ Hide details' : '▼ Show trade management'}
          </button>

          {expanded && (
            <div className="sc-details">
              {a.trade_management && (
                <div className="detail-section">
                  <span className="detail-title">⚙️ Trade Management</span>
                  <div className="detail-row"><span>Move SL to BE at</span><span className="cyan">{a.trade_management.move_sl_to_breakeven_at}</span></div>
                  <div className="detail-full"><span className="muted">Exit if:</span> {a.trade_management.exit_conditions}</div>
                  <div className="detail-full"><span className="muted">Invalidated if price hits:</span> {a.trade_management.invalidation}</div>
                </div>
              )}
              {a.position_sizing && (
                <div className="detail-section">
                  <span className="detail-title">💰 Position Sizing</span>
                  <div className="detail-row"><span>Risk per trade</span><span className="yellow">{a.position_sizing.risk_pct}% of account</span></div>
                  <div className="detail-full">{a.position_sizing.note}</div>
                </div>
              )}
              {a.key_levels && (
                <div className="detail-section">
                  <span className="detail-title">📊 Key Levels</span>
                  {a.key_levels.support?.length    > 0 && <div className="detail-row"><span>Support</span>    <span className="green">{a.key_levels.support.join(' · ')}</span></div>}
                  {a.key_levels.resistance?.length > 0 && <div className="detail-row"><span>Resistance</span> <span className="red">{a.key_levels.resistance.join(' · ')}</span></div>}
                </div>
              )}
              {a.reasoning && (
                <div className="sc-reasoning">
                  <span className="reasoning-label">AI Reasoning</span>
                  <p>{a.reasoning}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Outcome tracking ─────────────────────────────────── */}
      {item.outcome && (
        <div className={`outcome-${item.outcome}`} style={{ marginTop: '0.5rem' }}>
          {item.outcome === 'win' ? '✅' : item.outcome === 'loss' ? '❌' : '➖'}
          {' '}{item.outcome.toUpperCase()}
          {item.pnl != null && ` (${item.pnl > 0 ? '+' : ''}${item.pnl})`}
        </div>
      )}
      {!item.outcome && !showOutcomeForm && (
        <button className="btn-record-outcome" onClick={() => setShowOutcomeForm(true)}>Record Outcome</button>
      )}
      {showOutcomeForm && <OutcomeForm analysisId={item.id} onClose={() => setShowOutcomeForm(false)} />}
    </motion.div>
  );
}
