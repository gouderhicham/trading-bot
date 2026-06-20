export default function Analytics({ analyses }) {
  const closed = analyses.filter(a => a.outcome);

  // Group by strategy
  const byStrategy = {};
  for (const item of analyses) {
    const strat = item.strategy || 'Unknown';
    if (!byStrategy[strat]) byStrategy[strat] = { total: 0, approved: 0, wins: 0, losses: 0, confs: [] };
    byStrategy[strat].total++;
    if (item.riskPassed) byStrategy[strat].approved++;
    if (item.outcome === 'win')  byStrategy[strat].wins++;
    if (item.outcome === 'loss') byStrategy[strat].losses++;
    if (item.analysis?.confidence) byStrategy[strat].confs.push(item.analysis.confidence);
  }

  const strategies = Object.entries(byStrategy).map(([name, s]) => ({
    name,
    total:    s.total,
    approved: s.approved,
    approvalRate: s.total ? Math.round((s.approved / s.total) * 100) : 0,
    winRate:  (s.wins + s.losses) ? Math.round((s.wins / (s.wins + s.losses)) * 100) : null,
    avgConf:  s.confs.length ? Math.round(s.confs.reduce((a, b) => a + b, 0) / s.confs.length) : 0,
    wins:     s.wins,
    losses:   s.losses,
  })).sort((a, b) => b.total - a.total);

  // Confidence distribution buckets
  const confBuckets = [
    { label: '90-100%', min: 90, max: 100 },
    { label: '80-89%',  min: 80, max: 89  },
    { label: '75-79%',  min: 75, max: 79  },
    { label: '< 75%',   min: 0,  max: 74  },
  ];
  const confDist = confBuckets.map(b => ({
    ...b,
    count: analyses.filter(a => {
      const c = a.analysis?.confidence ?? 0;
      return c >= b.min && c <= b.max;
    }).length,
  }));
  const maxCount = Math.max(...confDist.map(b => b.count), 1);

  if (analyses.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">📊</span>
        <p>No signals yet. Analytics will appear once TradingView starts sending alerts.</p>
      </div>
    );
  }

  return (
    <div className="analytics-container">
      {/* Strategy breakdown */}
      <section className="analytics-section">
        <h3 className="section-title">Strategy Performance</h3>
        <div className="strategy-table-wrap">
          <table className="journal-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Signals</th>
                <th>Approval Rate</th>
                <th>Avg Confidence</th>
                <th>Win / Loss</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map(s => (
                <tr key={s.name}>
                  <td className="cyan">{s.name}</td>
                  <td>{s.total}</td>
                  <td>
                    <div className="mini-bar-wrap">
                      <div className="mini-bar green" style={{ width: `${s.approvalRate}%` }} />
                      <span>{s.approvalRate}%</span>
                    </div>
                  </td>
                  <td>{s.avgConf}%</td>
                  <td><span className="green">{s.wins}W</span> / <span className="red">{s.losses}L</span></td>
                  <td>{s.winRate !== null ? `${s.winRate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Confidence distribution */}
      <section className="analytics-section">
        <h3 className="section-title">Confidence Distribution</h3>
        <div className="conf-dist">
          {confDist.map(b => (
            <div className="conf-row" key={b.label}>
              <span className="conf-label">{b.label}</span>
              <div className="conf-bar-track">
                <div
                  className={`conf-bar ${b.min >= 75 ? 'approved' : 'rejected'}`}
                  style={{ width: `${Math.round((b.count / maxCount) * 100)}%` }}
                />
              </div>
              <span className="conf-count">{b.count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent learning summary */}
      {closed.length >= 5 && (
        <section className="analytics-section">
          <h3 className="section-title">Pattern Insights</h3>
          <div className="insights">
            {(() => {
              const topStrats = strategies.filter(s => s.winRate !== null).sort((a, b) => b.winRate - a.winRate);
              const best  = topStrats[0];
              const worst = topStrats[topStrats.length - 1];
              return (
                <>
                  {best && <p className="insight-line green">✅ Best strategy: <strong>{best.name}</strong> — {best.winRate}% win rate</p>}
                  {worst && worst.name !== best?.name && (
                    <p className="insight-line red">⚠️ Weakest strategy: <strong>{worst.name}</strong> — {worst.winRate}% win rate</p>
                  )}
                  <p className="insight-line cyan">
                    📊 {closed.length} closed trades recorded. Win rate overall: {
                      Math.round((closed.filter(a => a.outcome === 'win').length / closed.length) * 100)
                    }%
                  </p>
                </>
              );
            })()}
          </div>
        </section>
      )}
    </div>
  );
}
