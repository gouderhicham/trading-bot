// ─────────────────────────────────────────────────────────────────
//  Unified candle router
//
//  Source priority by symbol type:
//    Crypto / Gold  →  Binance (free, no key)
//                   →  TwelveData (fallback, needs key)
//
//    Forex          →  TwelveData (primary, needs key)
//                   →  Alpha Vantage (last resort, needs key)
//
//  Returns: normalised OHLCV array (oldest → newest)
//        or null   — caller MUST skip analysis, not proceed with guesses
// ─────────────────────────────────────────────────────────────────

import {
  BINANCE_MAP,      fetchFromBinance,
  TWELVEDATA_MAP,   fetchFromTwelveData,
  ALPHAVANTAGE_MAP, fetchFromAlphaVantage,
} from './sources';

// Minimum bars required — anything below this is too sparse for meaningful TA
export const MIN_BARS = 50;

// Timeframe label → minutes (used by BotEngine and MarketScanner)
export const TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60 };

// Union of every symbol that has at least one candle source
export const ANALYZABLE_SYMBOLS = new Set([
  ...Object.keys(BINANCE_MAP),
  ...Object.keys(TWELVEDATA_MAP),
  ...Object.keys(ALPHAVANTAGE_MAP),
]);

// ── Internal helpers ──────────────────────────────────────────────

// Try fetchers in order; skip to next on error or insufficient bars
async function tryChain(label, fetchers) {
  for (const { name, fn } of fetchers) {
    try {
      const candles = await fn();
      if (Array.isArray(candles) && candles.length >= MIN_BARS) {
        return { candles, source: name };
      }
    } catch (err) {
      console.debug(`[candles] ${label} · ${name} failed: ${err.message}`);
    }
  }
  return { candles: null, source: null };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Fetch normalised OHLCV candles for any supported symbol.
 *
 * @param {string} symbol    e.g. 'EURUSD', 'BTCUSD'
 * @param {string} timeframe e.g. '15m', '1h'
 * @param {number} limit     number of bars to request (default 200)
 * @returns {{ candles: Array|null, source: string|null }}
 *   candles = null → no data available; caller must skip Gemini call
 */
/** @returns {Promise<{candles: Array<object>|null, source: string|null}>} */
export async function fetchCandles(symbol, timeframe, limit = 200) {
  const isBinanceListed = Boolean(BINANCE_MAP[symbol]);

  if (isBinanceListed) {
    return tryChain(symbol, [
      { name: 'Binance',     fn: () => fetchFromBinance(symbol, timeframe, limit)     },
      { name: 'TwelveData',  fn: () => fetchFromTwelveData(symbol, timeframe, limit)  },
    ]);
  }

  // Forex (and any symbol only in TwelveData / AV maps)
  return tryChain(symbol, [
    { name: 'TwelveData',   fn: () => fetchFromTwelveData(symbol, timeframe, limit)  },
    { name: 'AlphaVantage', fn: () => fetchFromAlphaVantage(symbol, timeframe, limit) },
  ]);
}
