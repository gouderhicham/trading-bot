import { GoogleGenAI } from '@google/genai';
import { formatForPrompt } from './technicalAnalysis';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are a strict, professional quantitative trading analyst.

RULES — follow exactly:
1. Base EVERY number (entry, SL, TP, R:R) on the TECHNICAL DATA provided. Do not invent levels.
2. Entry must sit at a logical technical location (near EMA, support/resistance, BB band) visible in the data.
3. Stop-loss must be placed beyond the nearest swing high/low shown in the data.
4. Take-profit targets must align with visible resistance/support levels or R:R multiples of the SL distance.
5. Confidence must reflect the actual alignment of indicators — do NOT inflate it.
6. If indicators conflict badly (e.g. RSI overbought AND price below EMA), set confidence < 50 and explain.
7. If data is sparse, be conservative: wider zones, lower confidence, smaller position size.
8. NEVER fabricate technical levels not derivable from the supplied data.
9. Return ONLY valid JSON — no markdown, no explanations outside the JSON.`;

function buildPrompt(alert, technicalSummary) {
  const tf = alert.timeframe ? `${alert.timeframe}m` : 'N/A';

  // Direction line
  const direction = alert.signal && alert.signal !== 'N/A'
    ? alert.signal
    : 'DETERMINE from indicators (must be LONG or SHORT based on the data)';

  // Full technical context block
  const techBlock = formatForPrompt(technicalSummary, alert.symbol, tf);

  return `Analyze the following market data and produce a complete, evidence-based trade plan.
Every price level you return MUST be derivable from the technical data below — no guessing.

INSTRUMENT:  ${alert.symbol}
MARKET:      ${alert.exchange || 'Forex/Spot'}
TIMEFRAME:   ${tf}
DIRECTION:   ${direction}
STRATEGY:    ${alert.strategy || 'Technical'}
PRICE NOW:   ${alert.close ?? alert.price ?? 'See data'}

${techBlock}

Using ONLY the data above, return this JSON with real calculated values.
Every numeric field is required — no nulls allowed for price fields:

{
  "approve": true or false,
  "confidence": integer 0-100 (must reflect actual indicator alignment),
  "risk_rating": "low" | "medium" | "high",

  "entry": {
    "price": number (must reference a level visible in the data),
    "zone_low": number,
    "zone_high": number,
    "type": "market" | "limit" | "wait_for_retest",
    "timing": "precise sentence on trigger condition"
  },

  "stop_loss": {
    "price": number (beyond nearest swing high/low from the data),
    "reasoning": "reference specific level from the data"
  },

  "take_profits": [
    { "level": 1, "price": number, "pct_of_position": 50, "reasoning": "reference S/R or R:R from data" },
    { "level": 2, "price": number, "pct_of_position": 30, "reasoning": "reference S/R or R:R from data" },
    { "level": 3, "price": number, "pct_of_position": 20, "reasoning": "reference S/R or R:R from data" }
  ],

  "risk_reward": number (distance to TP1 / distance to SL — calculated, not estimated),

  "trade_management": {
    "move_sl_to_breakeven_at": number,
    "exit_conditions": "specific price-action conditions that would trigger early exit",
    "max_hold_time": "realistic duration based on timeframe",
    "invalidation": "exact price that invalidates the setup"
  },

  "position_sizing": {
    "risk_pct": number (max 2),
    "note": "sizing note referencing ATR or volatility from data"
  },

  "key_levels": {
    "support": [number, number],
    "resistance": [number, number]
  },

  "summary": "one sentence citing specific indicator values that support the trade",
  "reasoning": "3-4 sentences. Reference exact indicator readings (RSI X, EMA cross, MACD histogram) from the data. Explain why the direction was chosen and where each price level comes from."
}`;
}

export async function analyzeTradeSignal(alertData, technicalSummary = null) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: buildPrompt(alertData, technicalSummary),
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  let text = response.text.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const parsed = JSON.parse(text);

  return {
    approve:          Boolean(parsed.approve),
    confidence:       Number(parsed.confidence)  || 0,
    risk_rating:      parsed.risk_rating         || 'high',
    entry:            parsed.entry               || null,
    stop_loss:        parsed.stop_loss           || null,
    take_profits:     Array.isArray(parsed.take_profits) ? parsed.take_profits : [],
    risk_reward:      Number(parsed.risk_reward) || 0,
    trade_management: parsed.trade_management    || null,
    position_sizing:  parsed.position_sizing     || null,
    key_levels:       parsed.key_levels          || null,
    summary:          parsed.summary             || '',
    reasoning:        parsed.reasoning           || '',
  };
}
