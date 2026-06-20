// ─────────────────────────────────────────────────────────────────
//  Raw candle fetchers — one per data source
//
//  Contract:
//    • Returns a normalised OHLCV array (oldest → newest) on success
//    • Returns null   when the symbol is unsupported by that source
//    • Throws         on HTTP/network/parse errors (caller decides retry)
// ─────────────────────────────────────────────────────────────────


// ── Binance ───────────────────────────────────────────────────────
// Free, no key required. Covers crypto + gold (via PAX Gold, 1:1 to troy oz).

export const BINANCE_MAP = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
  BNBUSD: 'BNBUSDT',
  SOLUSD: 'SOLUSDT',
  XAUUSD: 'PAXGUSDT',
};

const BINANCE_TF = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h',
};

export async function fetchFromBinance(symbol, timeframe, limit) {
  const pair = BINANCE_MAP[symbol];
  if (!pair) return null;

  const interval = BINANCE_TF[timeframe] ?? '15m';
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) return null;

  return data.map(k => ({
    time:   k[0],
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}


// ── Twelve Data ───────────────────────────────────────────────────
// Free tier: 800 credits/day · 8 req/min.
// Covers: Forex + Crypto + Gold (XAU/USD natively).
// Requires: VITE_TWELVEDATA_API_KEY in .env

export const TWELVEDATA_MAP = {
  // Forex
  EURUSD: 'EUR/USD',
  USDJPY: 'USD/JPY',
  GBPUSD: 'GBP/USD',
  AUDUSD: 'AUD/USD',
  USDCHF: 'USD/CHF',
  // Metals
  XAUUSD: 'XAU/USD',
  // Crypto (fallback if Binance is down)
  BTCUSD: 'BTC/USD',
  ETHUSD: 'ETH/USD',
  BNBUSD: 'BNB/USD',
  SOLUSD: 'SOL/USD',
};

const TWELVEDATA_TF = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h',
};

export async function fetchFromTwelveData(symbol, timeframe, limit) {
  const apiKey = import.meta.env.VITE_TWELVEDATA_API_KEY;
  if (!apiKey) return null;

  const pair = TWELVEDATA_MAP[symbol];
  if (!pair) return null;

  const interval = TWELVEDATA_TF[timeframe] ?? '15min';
  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(pair)}&interval=${interval}` +
    `&outputsize=${limit}&apikey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);

  const json = await res.json();
  if (json.status === 'error') throw new Error(`TwelveData: ${json.message}`);
  if (!Array.isArray(json.values) || json.values.length === 0) return null;

  // API returns newest-first — reverse to chronological
  return json.values.slice().reverse().map(v => ({
    time:   new Date(v.datetime).getTime(),
    open:   parseFloat(v.open),
    high:   parseFloat(v.high),
    low:    parseFloat(v.low),
    close:  parseFloat(v.close),
    volume: parseFloat(v.volume || 0),
  }));
}


// ── Alpha Vantage ─────────────────────────────────────────────────
// Free tier: 25 req/day. Forex only (no crypto, no gold).
// Used as last-resort fallback for forex when TwelveData is unavailable.
// Requires: VITE_ALPHAVANTAGE_API_KEY in .env

export const ALPHAVANTAGE_MAP = {
  EURUSD: { from: 'EUR', to: 'USD' },
  USDJPY: { from: 'USD', to: 'JPY' },
  GBPUSD: { from: 'GBP', to: 'USD' },
  AUDUSD: { from: 'AUD', to: 'USD' },
  USDCHF: { from: 'USD', to: 'CHF' },
};

const AV_TF = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '60min',
};

export async function fetchFromAlphaVantage(symbol, timeframe, limit) {
  const apiKey = import.meta.env.VITE_ALPHAVANTAGE_API_KEY;
  if (!apiKey) return null;

  const pair = ALPHAVANTAGE_MAP[symbol];
  if (!pair) return null;

  const interval = AV_TF[timeframe] ?? '15min';
  const url =
    `https://www.alphavantage.co/query` +
    `?function=FX_INTRADAY&from_symbol=${pair.from}&to_symbol=${pair.to}` +
    `&interval=${interval}&outputsize=full&apikey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage HTTP ${res.status}`);

  const json = await res.json();
  const seriesKey = Object.keys(json).find(k => k.startsWith('Time Series Forex'));
  if (!seriesKey) throw new Error(`AlphaVantage: no series in response`);

  const series = json[seriesKey];
  return Object.entries(series)
    .sort(([a], [b]) => a.localeCompare(b))     // ascending (oldest first)
    .slice(-limit)
    .map(([datetime, v]) => ({
      time:   new Date(datetime).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: 0,                                  // AV forex has no volume
    }));
}
