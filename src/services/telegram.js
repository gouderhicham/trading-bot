import axios from 'axios';

const TOKEN   = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
const CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID;

export async function sendTelegramMessage(text) {
  if (!TOKEN || !CHAT_ID) return;
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'Markdown',
  });
}

export function buildApprovedMessage(alert, analysis) {
  const isLong = (alert.signal || '').toUpperCase() === 'LONG';
  const dir    = isLong ? '🚀' : '🔻';
  const risk   = { low: '🟢', medium: '🟡', high: '🔴' }[analysis.risk_rating] ?? '⚪';

  const tps = (analysis.take_profits || [])
    .map(tp => `  TP${tp.level}: \`${tp.price}\` (${tp.pct_of_position}%)`)
    .join('\n');

  const entry = analysis.entry;
  const sl    = analysis.stop_loss;
  const mgmt  = analysis.trade_management;
  const pos   = analysis.position_sizing;

  return (
    `${dir} *${alert.symbol} ${alert.signal}* — ${analysis.summary}\n\n` +

    `💡 Confidence: *${analysis.confidence}%* | ${risk} Risk: *${analysis.risk_rating.toUpperCase()}* | ⚖️ R:R: *${analysis.risk_reward}*\n\n` +

    `📍 *ENTRY*\n` +
    `  Price: \`${entry?.price}\`  (zone: \`${entry?.zone_low}\` – \`${entry?.zone_high}\`)\n` +
    `  Type: ${entry?.type} — ${entry?.timing}\n\n` +

    `🛑 *STOP LOSS:* \`${sl?.price}\`\n` +
    `  _${sl?.reasoning}_\n\n` +

    `🎯 *TAKE PROFITS*\n${tps}\n\n` +

    `⚙️ *TRADE MANAGEMENT*\n` +
    `  Move SL to BE at: \`${mgmt?.move_sl_to_breakeven_at}\`\n` +
    `  Max hold: ${mgmt?.max_hold_time}\n` +
    `  Exit early if: ${mgmt?.exit_conditions}\n` +
    `  Invalidated if: ${mgmt?.invalidation}\n\n` +

    `💰 *POSITION SIZE:* Risk ${pos?.risk_pct}% — ${pos?.note}\n\n` +

    `📝 *Analysis:*\n${analysis.reasoning}\n\n` +

    `_${alert.strategy || 'N/A'} | ${alert.timeframe || 'N/A'}m | ${alert.exchange || 'N/A'}_`
  );
}

export function buildRejectedMessage(alert, analysis, rejections) {
  return (
    `⚠️ *FILTERED: ${alert.symbol} ${alert.signal || ''}*\n\n` +
    `Confidence: ${analysis.confidence}% | R:R: ${analysis.risk_reward}\n\n` +
    `*Rejected:*\n${rejections.map(r => `• ${r}`).join('\n')}\n\n` +
    `_${analysis.summary}_`
  );
}
