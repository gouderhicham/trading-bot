import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { motion } from 'framer-motion';

function OutcomeForm({ analysisId, onClose }) {
  const [outcome, setOutcome] = useState('win');
  const [pnl, setPnl]         = useState('');
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);

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
          <button
            key={o}
            className={`outcome-btn outcome-${o} ${outcome === o ? 'active' : ''}`}
            onClick={() => setOutcome(o)}
          >
            {o === 'win' ? '✅' : o === 'loss' ? '❌' : '➖'} {o.charAt(0).toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
      <div className="outcome-inputs">
        <input type="number" placeholder="P&L (optional)" value={pnl} onChange={e => setPnl(e.target.value)} className="outcome-input" />
        <input type="text" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="outcome-input" />
      </div>
      <div className="outcome-actions">
        <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Outcome'}</button>
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function SignalCard({ item }) {
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const a = item.analysis || {};

  const isLong  = (item.signal || '').toUpperCase() === 'LONG';
  const isShort = (item.signal || '').toUpperCase() === 'SHORT';
  const dirClass = isLong ? 'long' : isShort ? 'short' : 'neutral';
  const riskColor = { low: 'green', medium: 'yellow', high: 'red' }[a.risk_rating] || 'grey';

  const outcomeStyle = {
    win:       { icon: '✅', cls: 'outcome-win'       },
    loss:      { icon: '❌', cls: 'outcome-loss'      },
    breakeven: { icon: '➖', cls: 'outcome-breakeven' },
  };

  const ts = item.createdAt?.toDate?.() ?? null;
  const timeStr = ts
    ? ts.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <motion.div
      className={`signal-card signal-${dirClass} ${!item.riskPassed ? 'signal-rejected' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="sc-header">
        <div className="sc-title">
          <span className={`sc-dir dir-${dirClass}`}>{isLong ? '▲' : isShort ? '▼' : '●'} {item.signal || 'SIGNAL'}</span>
          <span className="sc-symbol">{item.symbol}</span>
          <span className="sc-strategy">{item.strategy || ''}</span>
        </div>
        <div className="sc-meta">
          <span className="sc-tf">{item.timeframe ? `${item.timeframe}m` : ''}</span>
          <span className="sc-time">{timeStr}</span>
        </div>
      </div>

      {/* Badges */}
      <div className="sc-badges">
        {item.riskPassed
          ? <span className="badge approved">✓ APPROVED</span>
          : <span className="badge rejected">✗ REJECTED</span>
        }
        <span className={`badge risk-${riskColor}`}>{(a.risk_rating || 'N/A').toUpperCase()}</span>
        <span className="badge conf-badge">🧠 {a.confidence}%</span>
        <span className="badge rr-badge">⚖️ {a.risk_reward}</span>
        {item.outcome && (
          <span className={outcomeStyle[item.outcome]?.cls}>
            {outcomeStyle[item.outcome]?.icon} {item.outcome.toUpperCase()}
            {item.pnl != null && ` (${item.pnl > 0 ? '+' : ''}${item.pnl})`}
          </span>
        )}
      </div>

      {/* Rejection reasons */}
      {!item.riskPassed && item.riskRejections?.length > 0 && (
        <div className="sc-rejections">
          {item.riskRejections.map((r, i) => <span key={i} className="rejection-reason">• {r}</span>)}
        </div>
      )}

      {/* Summary */}
      {a.summary && <p className="sc-summary">{a.summary}</p>}

      {/* Entry / SL / TPs row */}
      {item.riskPassed && a.entry && (
        <div className="sc-trade-plan">
          {/* Entry */}
          <div className="tp-block">
            <span className="tp-block-label">📍 Entry</span>
            <span className="tp-price cyan">{a.entry.price}</span>
            <span className="tp-sub">zone: {a.entry.zone_low} – {a.entry.zone_high}</span>
            <span className="tp-sub italic">{a.entry.type} · {a.entry.timing}</span>
          </div>

          {/* Stop Loss */}
          <div className="tp-block">
            <span className="tp-block-label">🛑 Stop Loss</span>
            <span className="tp-price red">{a.stop_loss?.price}</span>
            <span className="tp-sub italic">{a.stop_loss?.reasoning}</span>
          </div>

          {/* Take Profits */}
          <div className="tp-block">
            <span className="tp-block-label">🎯 Take Profits</span>
            {(a.take_profits || []).map(tp => (
              <div key={tp.level} className="tp-row">
                <span className="tp-level">TP{tp.level}</span>
                <span className="tp-price green">{tp.price}</span>
                <span className="tp-pct">{tp.pct_of_position}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable details */}
      {item.riskPassed && (a.trade_management || a.position_sizing || a.key_levels) && (
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
                  <div className="detail-row"><span>Max hold time</span><span>{a.trade_management.max_hold_time}</span></div>
                  <div className="detail-full"><span className="muted">Exit early if:</span> {a.trade_management.exit_conditions}</div>
                  <div className="detail-full"><span className="muted">Invalidated if:</span> {a.trade_management.invalidation}</div>
                </div>
              )}

              {a.position_sizing && (
                <div className="detail-section">
                  <span className="detail-title">💰 Position Size</span>
                  <div className="detail-row"><span>Risk</span><span className="yellow">{a.position_sizing.risk_pct}% of account</span></div>
                  <div className="detail-full">{a.position_sizing.note}</div>
                </div>
              )}

              {a.key_levels && (
                <div className="detail-section">
                  <span className="detail-title">📊 Key Levels</span>
                  {a.key_levels.support?.length > 0 && (
                    <div className="detail-row"><span>Support</span><span className="green">{a.key_levels.support.join(' · ')}</span></div>
                  )}
                  {a.key_levels.resistance?.length > 0 && (
                    <div className="detail-row"><span>Resistance</span><span className="red">{a.key_levels.resistance.join(' · ')}</span></div>
                  )}
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

      {/* Record outcome */}
      {item.riskPassed && !item.outcome && !showOutcomeForm && (
        <button className="btn-record-outcome" onClick={() => setShowOutcomeForm(true)}>Record Outcome</button>
      )}
      {showOutcomeForm && <OutcomeForm analysisId={item.id} onClose={() => setShowOutcomeForm(false)} />}
    </motion.div>
  );
}
