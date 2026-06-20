export default function StatsBar({ analyses }) {
  const total     = analyses.length;
  const approved  = analyses.filter(a => a.riskPassed).length;
  const withConf  = analyses.filter(a => a.analysis?.confidence > 0);
  const avgConf   = withConf.length
    ? Math.round(withConf.reduce((s, a) => s + a.analysis.confidence, 0) / withConf.length)
    : 0;
  const closed    = analyses.filter(a => a.outcome);
  const wins      = closed.filter(a => a.outcome === 'win').length;
  const winRate   = closed.length ? Math.round((wins / closed.length) * 100) : null;

  const stats = [
    { label: 'Total Signals',  value: total,                      icon: '📡', color: 'cyan'   },
    { label: 'Approval Rate',  value: total ? `${Math.round((approved/total)*100)}%` : '—', icon: '✅', color: 'green'  },
    { label: 'Avg Confidence', value: withConf.length ? `${avgConf}%` : '—',           icon: '🧠', color: 'purple' },
    { label: 'Win Rate',       value: winRate !== null ? `${winRate}%` : '—',           icon: '🏆', color: 'yellow' },
  ];

  return (
    <div className="stats-bar">
      {stats.map(s => (
        <div className={`stat-card stat-${s.color}`} key={s.label}>
          <span className="stat-icon">{s.icon}</span>
          <div className="stat-content">
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
