// ── RSI — Wilder's smoothing ─────────────────────────────────
export function computeRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for the rest
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0))  / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

// ── EMA — single final value ─────────────────────────────────
export function computeEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

// ── EMA array (needed for MACD) ──────────────────────────────
function emaArray(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [e];
  for (let i = period; i < values.length; i++) { e = values[i] * k + e * (1 - k); out.push(e); }
  return out;
}

// ── MACD(12,26,9) ────────────────────────────────────────────
export function computeMACD(closes, fast = 12, slow = 26, sig = 9) {
  if (!closes || closes.length < slow + sig) return null;
  const fastArr = emaArray(closes, fast);
  const slowArr = emaArray(closes, slow);
  // align: slowArr is shorter; fastArr has (fast-1) more leading values
  const offset  = fastArr.length - slowArr.length;
  const macdArr = slowArr.map((v, i) => fastArr[offset + i] - v);
  if (macdArr.length < sig) return null;
  const sigArr  = emaArray(macdArr, sig);
  const lastM   = macdArr[macdArr.length - 1];
  const lastS   = sigArr[sigArr.length - 1];
  const prevM   = macdArr[macdArr.length - 2];
  const prevSig = sigArr[sigArr.length - 2];
  return {
    macd:       lastM,
    signal:     lastS,
    histogram:  lastM - lastS,
    crossover:  lastM > lastS && prevM <= prevSig,   // bullish cross
    crossunder: lastM < lastS && prevM >= prevSig,   // bearish cross
  };
}

// ── Bollinger Bands(20,2) ─────────────────────────────────────
export function computeBollingerBands(closes, period = 20, nStd = 2) {
  if (!closes || closes.length < period) return null;
  const slice   = closes.slice(-period);
  const sma     = slice.reduce((a, b) => a + b, 0) / period;
  const std     = Math.sqrt(slice.reduce((s, v) => s + (v - sma) ** 2, 0) / period);
  const upper   = sma + nStd * std;
  const lower   = sma - nStd * std;
  const last    = closes[closes.length - 1];
  const pctB    = upper === lower ? 50 : (last - lower) / (upper - lower) * 100;
  return { upper, middle: sma, lower, width_pct: (upper - lower) / sma * 100, pct_b: pctB };
}

// ── ATR(14) ───────────────────────────────────────────────────
export function computeATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── Swing S/R from local extremes ────────────────────────────
export function findKeyLevels(highs, lows) {
  const swH = [], swL = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) swH.push(highs[i]);
    if (lows[i]  < lows[i-1]  && lows[i]  < lows[i-2]  && lows[i]  < lows[i+1]  && lows[i]  < lows[i+2])  swL.push(lows[i]);
  }
  return {
    resistance: [...new Set(swH)].sort((a, b) => b - a).slice(0, 3),
    support:    [...new Set(swL)].sort((a, b) => a - b).slice(0, 3),
  };
}

// ── Trend label ───────────────────────────────────────────────
export function assessTrend(closes, ema9, ema20, ema50) {
  const last = closes[closes.length - 1];
  if (!ema20) return 'unknown';
  const up9  = ema9  != null && ema9  > ema20;
  const up50 = ema50 != null && ema20 > ema50;
  if (up9 && up50  && last > ema20) return 'strong uptrend';
  if (up9 && last > ema20)          return 'uptrend';
  if (!up9 && up50 && last > ema50) return 'potential reversal up';
  if (!up9 && !up50 && last < ema20) return ema50 && ema20 < ema50 ? 'strong downtrend' : 'downtrend';
  return 'ranging / consolidation';
}

// ── Volume analysis ───────────────────────────────────────────
export function analyzeVolume(volumes) {
  if (!volumes || volumes.length < 5) return null;
  const last  = volumes[volumes.length - 1];
  const avg   = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const ratio = last / avg;
  return {
    last, avg, ratio,
    label: ratio > 1.5 ? 'HIGH (spike)' : ratio < 0.5 ? 'LOW (drying up)' : 'normal',
  };
}

// ── Master builder ────────────────────────────────────────────
export function buildTechnicalSummary(candles, dataSource = 'unknown') {
  if (!candles || candles.length < 20) return null;

  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const vols   = candles.map(c => c.volume).filter(v => v != null && v > 0);

  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  const rsi    = computeRSI(closes);
  const ema9   = computeEMA(closes, 9);
  const ema20  = computeEMA(closes, 20);
  const ema50  = closes.length >= 50 ? computeEMA(closes, 50) : null;
  const macd   = computeMACD(closes);
  const bb     = computeBollingerBands(closes);
  const atr    = computeATR(highs, lows, closes);
  const levels = findKeyLevels(highs, lows);
  const trend  = assessTrend(closes, ema9, ema20, ema50);
  const vol    = analyzeVolume(vols);

  return {
    data_source:   dataSource,
    candle_count:  candles.length,
    last_close:    last,
    prev_close:    prev,
    change_pct:    (last - prev) / prev * 100,
    high_20:       Math.max(...highs.slice(-20)),
    low_20:        Math.min(...lows.slice(-20)),
    rsi,
    ema:           { ema9, ema20, ema50 },
    macd,
    bollinger:     bb,
    atr,
    key_levels:    levels,
    trend,
    volume:        vol,
    last5_candles: candles.slice(-5),
  };
}

// ── Compact single-line TF summary for multi-TF overview ────
export function formatCompact(summary, tf) {
  if (!summary) return `  [${tf}] no data`;
  const { rsi, ema, macd, bollinger: bb, atr, trend, last_close, candle_count } = summary;

  const dp = v => {
    if (v == null) return 'N/A';
    const a = Math.abs(v);
    if (a >= 10000) return v.toFixed(1);
    if (a >= 100)   return v.toFixed(2);
    if (a >= 1)     return v.toFixed(5);
    return v.toFixed(8);
  };

  let emaAlign = 'N/A';
  if (ema.ema9 && ema.ema20) {
    emaAlign = ema.ema50
      ? (ema.ema9 > ema.ema20 && ema.ema20 > ema.ema50 ? 'BULL' : ema.ema9 < ema.ema20 && ema.ema20 < ema.ema50 ? 'BEAR' : 'MIX')
      : (ema.ema9 > ema.ema20 ? 'BULL' : 'BEAR');
  }

  const macdStr = macd
    ? `${macd.histogram > 0 ? '▲' : '▼'}${macd.crossover ? 'CROSS↑' : macd.crossunder ? 'CROSS↓' : ''}`
    : 'N/A';

  return `  [${tf}·${candle_count}bars] Last=${dp(last_close)} RSI=${rsi ?? 'N/A'} EMA=${emaAlign} MACD=${macdStr} BB=%B${bb ? bb.pct_b.toFixed(0) : 'N/A'}% ATR=${dp(atr)} → ${trend.toUpperCase()}`;
}

// ── Format summary as readable text block for Gemini ─────────
export function formatForPrompt(summary, symbol, timeframe) {
  if (!summary) {
    // Hard error — BotEngine must gate before reaching this point.
    // Never allow Gemini to receive a prompt without real OHLCV data.
    throw new Error(`formatForPrompt: no technical summary for ${symbol} ${timeframe} — analysis should have been skipped`);
  }

  // Helper: smart decimal precision based on price magnitude
  const dp = (v) => {
    if (v == null || isNaN(v)) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 10000) return v.toFixed(1);
    if (abs >= 100)   return v.toFixed(2);
    if (abs >= 1)     return v.toFixed(5);
    return v.toFixed(8);
  };

  const { rsi, ema, macd, bollinger: bb, atr, key_levels: kl, trend, volume: vol, last5_candles } = summary;

  // RSI label
  const rsiLabel = rsi == null ? '' :
    rsi < 25 ? '— STRONGLY OVERSOLD' :
    rsi < 35 ? '— oversold' :
    rsi > 75 ? '— STRONGLY OVERBOUGHT' :
    rsi > 65 ? '— overbought' :
    rsi < 48 ? '— bearish lean' :
    rsi > 52 ? '— bullish lean' : '— neutral';

  // EMA alignment
  let emaAlign = 'N/A';
  if (ema.ema9 && ema.ema20) {
    if (ema.ema50) {
      if (ema.ema9 > ema.ema20 && ema.ema20 > ema.ema50)      emaAlign = 'BULLISH (9 > 20 > 50)';
      else if (ema.ema9 < ema.ema20 && ema.ema20 < ema.ema50) emaAlign = 'BEARISH (9 < 20 < 50)';
      else                                                      emaAlign = 'MIXED';
    } else {
      emaAlign = ema.ema9 > ema.ema20 ? 'BULLISH (9 > 20)' : 'BEARISH (9 < 20)';
    }
  }

  // MACD
  let macdStr = 'N/A';
  if (macd) {
    const dir = macd.histogram > 0 ? 'bullish' : 'bearish';
    const cross = macd.crossover ? ' ← BULLISH CROSSOVER' : macd.crossunder ? ' ← BEARISH CROSSUNDER' : '';
    macdStr = `MACD=${dp(macd.macd)}, Signal=${dp(macd.signal)}, Hist=${dp(macd.histogram)} (${dir}${cross})`;
  }

  // Bollinger Bands
  let bbStr = 'N/A';
  if (bb) {
    const pos = bb.pct_b > 80 ? 'near upper (overbought zone)' :
                bb.pct_b < 20 ? 'near lower (oversold zone)' :
                bb.pct_b > 50 ? 'upper half' : 'lower half';
    bbStr = `Upper=${dp(bb.upper)}, Mid=${dp(bb.middle)}, Lower=${dp(bb.lower)}, %B=${bb.pct_b.toFixed(1)}% (${pos})`;
  }

  const lines = [
    `═══ TECHNICAL DATA — ${symbol} · ${timeframe} · ${summary.candle_count} candles (${summary.data_source}) ═══`,
    `Price:     ${dp(summary.last_close)}  (${summary.change_pct >= 0 ? '+' : ''}${summary.change_pct.toFixed(3)}% vs prev close)`,
    `20-bar:    High ${dp(summary.high_20)} · Low ${dp(summary.low_20)} · Range ${dp(summary.high_20 - summary.low_20)}`,
    ``,
    `RSI(14):   ${rsi ?? 'N/A'} ${rsiLabel}`,
    `EMA:       9=${dp(ema.ema9)}  20=${dp(ema.ema20)}  50=${dp(ema.ema50)}`,
    `EMA align: ${emaAlign}`,
    `MACD:      ${macdStr}`,
    `BB(20,2):  ${bbStr}`,
    `ATR(14):   ${dp(atr)} (${atr && summary.last_close ? (atr / summary.last_close * 100).toFixed(3) + '% of price' : 'N/A'})`,
    ``,
    `TREND:     ${trend.toUpperCase()}`,
  ];

  if (kl.resistance.length || kl.support.length) {
    lines.push(``, `KEY LEVELS (swing-based):`);
    if (kl.resistance.length) lines.push(`  Resistance: ${kl.resistance.map(dp).join(' · ')}`);
    if (kl.support.length)    lines.push(`  Support:    ${kl.support.map(dp).join(' · ')}`);
  }

  if (vol) {
    lines.push(``, `VOLUME:    ${vol.last.toFixed(2)} (${vol.ratio.toFixed(2)}x 20-bar avg — ${vol.label})`);
  }

  if (last5_candles?.length) {
    lines.push(``, `LAST 5 CANDLES  [Open / High / Low / Close${vol ? ' / Volume' : ''}]:`);
    last5_candles.forEach(c => {
      const vStr = (c.volume != null && vol) ? ` / ${c.volume.toFixed(2)}` : '';
      lines.push(`  ${dp(c.open)} / ${dp(c.high)} / ${dp(c.low)} / ${dp(c.close)}${vStr}`);
    });
  }

  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join('\n');
}
