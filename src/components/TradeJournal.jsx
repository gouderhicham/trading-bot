import { motion } from 'framer-motion';

const OUTCOME_META = {
  win:       { icon: '✅', label: 'Win',       cls: 'outcome-win'       },
  loss:      { icon: '❌', label: 'Loss',      cls: 'outcome-loss'      },
  breakeven: { icon: '➖', label: 'Breakeven', cls: 'outcome-breakeven' },
};

export default function TradeJournal({ analyses }) {
  const closed = analyses
    .filter(a => a.outcome)
    .sort((a, b) => (b.closedAt?.toDate?.() ?? 0) - (a.closedAt?.toDate?.() ?? 0));

  const wins      = closed.filter(a => a.outcome === 'win').length;
  const losses    = closed.filter(a => a.outcome === 'loss').length;
  const totalPnl  = closed.reduce((s, a) => s + (a.pnl || 0), 0);
  const winRate   = closed.length ? Math.round((wins / closed.length) * 100) : 0;

  if (closed.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">📒</span>
        <p>No closed trades yet. Record outcomes on your approved signals.</p>
      </div>
    );
  }

  return (
    <div className="journal-container">
      {/* Summary row */}
      <div className="journal-summary">
        <div className="js-stat"><span>{closed.length}</span><label>Total Trades</label></div>
        <div className="js-stat green"><span>{wins}</span><label>Wins</label></div>
        <div className="js-stat red"><span>{losses}</span><label>Losses</label></div>
        <div className="js-stat cyan"><span>{winRate}%</span><label>Win Rate</label></div>
        <div className={`js-stat ${totalPnl >= 0 ? 'green' : 'red'}`}>
          <span>{totalPnl > 0 ? '+' : ''}{totalPnl.toFixed(2)}</span>
          <label>Total P&L</label>
        </div>
      </div>

      {/* Table */}
      <div className="journal-table-wrap">
        <table className="journal-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Signal</th>
              <th>Strategy</th>
              <th>TF</th>
              <th>Entry</th>
              <th>Confidence</th>
              <th>R:R</th>
              <th>Outcome</th>
              <th>P&L</th>
              <th>Note</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {closed.map(item => {
              const meta  = OUTCOME_META[item.outcome];
              const ts    = item.closedAt?.toDate?.();
              const dateStr = ts
                ? ts.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
                : '—';

              return (
                <motion.tr
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <td className="cyan">{item.symbol}</td>
                  <td className={item.signal === 'LONG' ? 'green' : 'red'}>{item.signal || '—'}</td>
                  <td className="muted">{item.strategy || '—'}</td>
                  <td className="muted">{item.timeframe || '—'}</td>
                  <td>{item.price}</td>
                  <td>{item.analysis?.confidence ?? '—'}%</td>
                  <td>{item.analysis?.risk_reward ?? '—'}</td>
                  <td><span className={meta.cls}>{meta.icon} {meta.label}</span></td>
                  <td className={item.pnl > 0 ? 'green' : item.pnl < 0 ? 'red' : ''}>
                    {item.pnl != null ? `${item.pnl > 0 ? '+' : ''}${item.pnl}` : '—'}
                  </td>
                  <td className="muted">{item.outcomeNote || '—'}</td>
                  <td className="muted">{dateStr}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
