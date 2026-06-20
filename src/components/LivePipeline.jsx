const STAGES = [
  { key: 'received', label: 'Received',  icon: '📡' },
  { key: 'gemini',   label: 'Gemini AI', icon: '🧠' },
  { key: 'risk',     label: 'Risk Check', icon: '⚖️'  },
  { key: 'telegram', label: 'Notify',    icon: '📨' },
  { key: 'done',     label: 'Done',      icon: '✅' },
];
const STAGE_ORDER = STAGES.map(s => s.key);

export default function LivePipeline({ pipeline }) {
  if (!pipeline) {
    return (
      <div className="lp-idle">
        <div className="lp-idle-icon">⚡</div>
        <p>Awaiting next analysis</p>
        <small>Scanner is running in background</small>
      </div>
    );
  }

  const { stage, alert = {}, analysis, risk } = pipeline;
  const currentIdx = STAGE_ORDER.indexOf(stage);
  const isError    = stage === 'error';
  const isLong     = alert.signal?.toUpperCase() === 'LONG';
  const isShort    = alert.signal?.toUpperCase() === 'SHORT';

  return (
    <div className="lp-wrap">

      {/* ── Alert identity ──────────────────────────────────── */}
      <div className={`lp-alert ${isLong ? 'lp-long' : isShort ? 'lp-short' : 'lp-neutral'}`}>
        <div className="lp-alert-top">
          <span className={`lp-signal ${isLong ? 'sig-long' : isShort ? 'sig-short' : 'sig-neutral'}`}>
            {isLong ? '▲' : isShort ? '▼' : '●'} {alert.signal || 'SCAN'}
          </span>
          <span className="lp-sym">{alert.symbol}</span>
          {alert.timeframe && <span className="lp-tf-badge">{alert.timeframe}m</span>}
        </div>
        <div className="lp-alert-sub">
          {(alert.close ?? alert.price) != null && (
            <span className="lp-field">Price <code>{alert.close ?? alert.price}</code></span>
          )}
          {alert.rsi != null && (
            <span className={`lp-field lp-rsi ${alert.rsi < 30 ? 'rsi-os' : alert.rsi > 70 ? 'rsi-ob' : ''}`}>
              RSI <code>{alert.rsi}</code>
            </span>
          )}
          {alert.exchange && <span className="lp-field lp-dim">{alert.exchange}</span>}
          {alert.strategy && <span className="lp-field lp-dim">{alert.strategy}</span>}
        </div>
      </div>

      {/* ── Stage progress bar ──────────────────────────────── */}
      <div className="lp-stages">
        {STAGES.map((s, i) => {
          const done   = !isError && i < currentIdx;
          const active = !isError && i === currentIdx;
          return (
            <div key={s.key} className="lp-stage-item">
              {i > 0 && <div className={`lp-connector ${done ? 'conn-done' : ''}`} />}
              <div className={`lp-dot ${done ? 'dot-done' : active ? 'dot-active' : 'dot-pending'}`}>
                {done ? '✓' : active ? <span className="dot-spin">{s.icon}</span> : s.icon}
              </div>
              <span className={`lp-stage-name ${done ? 'sn-done' : active ? 'sn-active' : 'sn-pending'}`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Gemini thinking ─────────────────────────────────── */}
      {stage === 'gemini' && (
        <div className="lp-thinking">
          <div className="think-dots"><span /><span /><span /></div>
          <span>Evaluating entry zones, SL, TP targets, position sizing...</span>
        </div>
      )}

      {/* ── Gemini output ───────────────────────────────────── */}
      {analysis && (
        <div className="lp-result">

          {/* Key metrics row */}
          <div className="lp-metrics">
            <div className={`lp-metric ${analysis.confidence >= 75 ? 'm-good' : 'm-bad'}`}>
              <span className="m-label">Confidence</span>
              <span className="m-val">{analysis.confidence}%</span>
            </div>
            <div className={`lp-metric ${analysis.risk_reward >= 2 ? 'm-good' : 'm-bad'}`}>
              <span className="m-label">R:R</span>
              <span className="m-val">{analysis.risk_reward}</span>
            </div>
            <div className="lp-metric">
              <span className="m-label">Risk</span>
              <span className={`m-val m-risk-${analysis.risk_rating}`}>
                {(analysis.risk_rating || '—').toUpperCase()}
              </span>
            </div>
            {analysis.trade_management?.max_hold_time && (
              <div className="lp-metric">
                <span className="m-label">Hold</span>
                <span className="m-val m-dim">{analysis.trade_management.max_hold_time}</span>
              </div>
            )}
          </div>

          {/* Price levels */}
          {analysis.entry?.price && (
            <div className="lp-levels">
              <div className="ll-item">
                <span className="ll-tag">📍 Entry</span>
                <span className="ll-price cyan">{analysis.entry.price}</span>
                <span className="ll-sub">{analysis.entry.type}</span>
              </div>
              {analysis.stop_loss?.price && (
                <div className="ll-item">
                  <span className="ll-tag">🛑 SL</span>
                  <span className="ll-price red">{analysis.stop_loss.price}</span>
                </div>
              )}
              {(analysis.take_profits || []).map((tp, i) => (
                <div key={i} className="ll-item">
                  <span className="ll-tag">🎯 TP{tp.level}</span>
                  <span className="ll-price green">{tp.price}</span>
                  <span className="ll-sub">{tp.pct_of_position}%</span>
                </div>
              ))}
            </div>
          )}

          {/* AI summary */}
          {analysis.summary && (
            <p className="lp-summary">"{analysis.summary}"</p>
          )}

          {/* Risk reasoning excerpt */}
          {analysis.reasoning && (
            <p className="lp-reasoning">{analysis.reasoning}</p>
          )}
        </div>
      )}

      {/* ── Risk verdict ────────────────────────────────────── */}
      {risk && (
        <div className={`lp-verdict ${risk.passed ? 'lv-approved' : 'lv-rejected'}`}>
          {risk.passed
            ? `✅ APPROVED — passed all risk thresholds`
            : `🚫 REJECTED — ${risk.rejections.join(' · ')}`
          }
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────── */}
      {isError && (
        <div className="lp-error">❌ {pipeline.error || 'Unknown error'}</div>
      )}
    </div>
  );
}
