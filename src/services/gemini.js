import { GoogleGenAI } from '@google/genai';
import { formatCompact, formatForPrompt } from './technicalAnalysis';

// ── API key pool — rotates on 429 ─────────────────────────────────
const KEY_POOL = [
  import.meta.env.VITE_GEMINI_API_KEY,
  import.meta.env.VITE_GEMINI_API_KEY2,
  import.meta.env.VITE_GEMINI_API_KEY3,
  import.meta.env.VITE_GEMINI_API_KEY4,
  import.meta.env.VITE_GEMINI_API_KEY5,
  import.meta.env.VITE_GEMINI_API_KEY6,
  import.meta.env.VITE_GEMINI_API_KEY7,
  import.meta.env.VITE_GEMINI_API_KEY8,
  import.meta.env.VITE_GEMINI_API_KEY9,
].filter(Boolean);

if (KEY_POOL.length === 0) throw new Error('No Gemini API keys configured');
export const KEY_POOL_SIZE = KEY_POOL.length;

let keyIndex = 0;
function currentKey() { return KEY_POOL[keyIndex % KEY_POOL.length]; }
function rotateKey()  { keyIndex = (keyIndex + 1) % KEY_POOL.length; }

function is429(err) {
  return (
    err?.status      === 429 ||
    err?.httpCode    === 429 ||
    String(err?.message).includes('429') ||
    String(err?.message).includes('RESOURCE_EXHAUSTED') ||
    String(err?.message).includes('quota')
  );
}

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a strict, professional quantitative trading analyst specialising in multi-timeframe analysis.

RULES — follow exactly:
1. Analyse ALL timeframes provided. Use higher TFs for trend bias, lower TFs for entry precision.
2. Choose the BEST timeframe for the trade — one with the clearest setup and strongest confluence.
3. Map the chosen TF to the correct strategy: scalping (1m–5m), day_trading (15m–30m), swing_trading (1h+).
4. Base EVERY price level on the TECHNICAL DATA supplied. Never invent levels.
5. Stop-loss must clear the nearest swing high/low from the data.
6. Take-profits must align with visible S/R levels or strategy R:R targets.
7. Confidence MUST reflect actual multi-TF alignment — do NOT inflate it.
8. Set approve=false and explain no_trade_reason when conditions are not met.
9. Return ONLY valid JSON — no markdown, no explanations outside the JSON.`;

// ── Strategy requirements (used in prompt + risk engine) ─────────
export const STRATEGY_RULES = {
  scalping:      { minRR: 1.5, expiryMin: 30,   label: 'SCALPING'    },
  day_trading:   { minRR: 2.0, expiryMin: 240,  label: 'DAY TRADING' },
  swing_trading: { minRR: 3.0, expiryMin: 1440, label: 'SWING'       },
};

// ── Multi-TF prompt builder ───────────────────────────────────────
// tfSummaries: [{tf, summary, barCount}]  — sorted shortest→longest TF
function buildPrompt(alert, tfSummaries) {
  const symbol = alert.symbol;
  const price  = alert.close ?? alert.price ?? 'See data';

  // Compact overview — one line per TF
  const overview = tfSummaries
    .map(({ tf, summary }) => formatCompact(summary, tf))
    .join('\n');

  // Full detail for the lowest and highest available TFs (entry + macro)
  const tfs = tfSummaries;
  const lowest  = tfs[0];
  const highest = tfs[tfs.length - 1];
  const fullBlocks = [];
  fullBlocks.push(formatForPrompt(lowest.summary, symbol, lowest.tf));
  if (highest !== lowest) {
    fullBlocks.push(formatForPrompt(highest.summary, symbol, highest.tf));
  }

  return `Perform a complete multi-timeframe analysis for ${symbol} and produce an evidence-based trade plan.
Every price level you return MUST be derivable from the technical data below — no guessing.

INSTRUMENT: ${symbol}
MARKET:     ${alert.exchange || 'Forex/Spot'}
PRICE NOW:  ${price}
STRATEGY BIAS: ${alert.signal || 'DETERMINE from data'}

═══ MULTI-TIMEFRAME OVERVIEW (all available timeframes) ═══
${overview}

═══ FULL DETAIL — ${lowest.tf} (entry precision) ═══
${fullBlocks[0]}
${fullBlocks[1] ? `\n═══ FULL DETAIL — ${highest.tf} (macro trend) ═══\n${fullBlocks[1]}` : ''}

STRATEGY TARGET PARAMETERS (apply whichever strategy you select):
  scalping:      SL 20–30 pips · TP1 30p / TP2 40p / TP3 50p  · min RR 1:1.5 · expiry 30 min
  day_trading:   SL 30–50 pips · TP1 60p / TP2 80p / TP3 100p · min RR 1:2   · expiry 4 h (240 min)
  swing_trading: SL 50–100 pips· TP1 150p/ TP2 200p/ TP3 300p · min RR 1:3   · expiry 24 h (1440 min)

For crypto/gold: use ATR multiples in place of pips (note this in stop_loss.reasoning).

NO TRADE CONDITIONS — set approve=false if any apply:
  • Confidence below 75% after multi-TF assessment
  • R:R below the strategy minimum
  • Indicators strongly conflict across timeframes
  • Market is ranging/choppy across all TFs with no clear direction
  • ATR too small to fit both SL and TP profitably

Return ONLY this JSON (all numeric price fields are required — no nulls):

{
  "approve": true | false,
  "no_trade_reason": "string or null",
  "recommended_timeframe": "1m" | "5m" | "15m" | "30m" | "1h",
  "strategy": "scalping" | "day_trading" | "swing_trading",
  "direction": "LONG" | "SHORT",
  "confidence": integer 0–100,
  "confidence_breakdown": {
    "trend_analysis":    integer 0–100,
    "volume_analysis":   integer 0–100,
    "momentum":          integer 0–100,
    "market_structure":  integer 0–100
  },
  "risk_rating": "low" | "medium" | "high",
  "entry": {
    "price":      number,
    "zone_low":   number,
    "zone_high":  number,
    "type":       "market" | "limit" | "wait_for_retest",
    "timing":     "precise trigger condition"
  },
  "stop_loss": {
    "price":     number,
    "pips":      number,
    "reasoning": "reference specific swing level from data"
  },
  "take_profits": [
    { "level": 1, "price": number, "pips": number, "pct_of_position": 50, "reasoning": "cite S/R or R:R multiple" },
    { "level": 2, "price": number, "pips": number, "pct_of_position": 30, "reasoning": "cite S/R or R:R multiple" },
    { "level": 3, "price": number, "pips": number, "pct_of_position": 20, "reasoning": "cite S/R or R:R multiple" }
  ],
  "risk_reward": number,
  "signal_expiry_minutes": number,
  "mtf_confluence": "1–2 sentences summarising how the timeframes align or conflict",
  "trade_management": {
    "move_sl_to_breakeven_at": number,
    "exit_conditions":         "specific price-action triggers for early exit",
    "invalidation":            "exact price that invalidates the setup"
  },
  "position_sizing": {
    "risk_pct": number,
    "note":     "sizing note referencing ATR or volatility"
  },
  "key_levels": {
    "support":    [number, number],
    "resistance": [number, number]
  },
  "summary":   "one sentence citing specific multi-TF readings",
  "reasoning": "3–4 sentences: which TFs confirm the trade, which conflict, why this entry was chosen"
}`;
}

// ── Response parser ───────────────────────────────────────────────
function parseResponse(response) {
  let text = response.text.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const p = JSON.parse(text);
  return {
    approve:               Boolean(p.approve),
    no_trade_reason:       p.no_trade_reason      || null,
    recommended_timeframe: p.recommended_timeframe || null,
    strategy:              p.strategy              || 'day_trading',
    direction:             p.direction             || null,
    confidence:            Number(p.confidence)    || 0,
    confidence_breakdown:  p.confidence_breakdown  || null,
    risk_rating:           p.risk_rating           || 'high',
    entry:                 p.entry                 || null,
    stop_loss:             p.stop_loss             || null,
    take_profits:          Array.isArray(p.take_profits) ? p.take_profits : [],
    risk_reward:           Number(p.risk_reward)   || 0,
    signal_expiry_minutes: Number(p.signal_expiry_minutes) || null,
    mtf_confluence:        p.mtf_confluence        || '',
    trade_management:      p.trade_management      || null,
    position_sizing:       p.position_sizing       || null,
    key_levels:            p.key_levels            || null,
    summary:               p.summary               || '',
    reasoning:             p.reasoning             || '',
  };
}

// ── Main export — retries across all keys on 429 ──────────────────
// tfSummaries: [{tf, summary, barCount}] from BotEngine
// onRotate(from, to, total) — optional, fired on key switch
export async function analyzeTradeSignal(alertData, tfSummaries, { onRotate } = {}) {
  const prompt = buildPrompt(alertData, tfSummaries);
  const tried  = new Set();

  while (tried.size < KEY_POOL.length) {
    const keyIdx = keyIndex % KEY_POOL.length;
    tried.add(keyIdx);

    try {
      const client   = new GoogleGenAI({ apiKey: currentKey() });
      const response = await client.models.generateContent({
        model:    'gemini-2.5-flash',
        contents: prompt,
        config:   { systemInstruction: SYSTEM_PROMPT },
      });
      return parseResponse(response);

    } catch (err) {
      if (is429(err)) {
        const from = keyIdx + 1;
        rotateKey();
        const to = (keyIndex % KEY_POOL.length) + 1;
        console.warn(`[gemini] Key ${from}/${KEY_POOL.length} quota → rotating to key ${to}`);
        onRotate?.(from, to, KEY_POOL.length);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All ${KEY_POOL.length} Gemini API keys have hit their quota. Try again later.`);
}
