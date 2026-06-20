// ─────────────────────────────────────────────────────────────────
//  Market data — instrument registry, live prices, display utils
//  Candle fetching lives in src/services/candles/
// ─────────────────────────────────────────────────────────────────

export const INSTRUMENTS = [
  // Forex
  { symbol: 'EURUSD', label: 'EUR/USD', type: 'forex',  category: 'Forex',   icon: '🇪🇺' },
  { symbol: 'USDJPY', label: 'USD/JPY', type: 'forex',  category: 'Forex',   icon: '🇯🇵' },
  { symbol: 'GBPUSD', label: 'GBP/USD', type: 'forex',  category: 'Forex',   icon: '🇬🇧' },
  { symbol: 'AUDUSD', label: 'AUD/USD', type: 'forex',  category: 'Forex',   icon: '🇦🇺' },
  { symbol: 'USDCHF', label: 'USD/CHF', type: 'forex',  category: 'Forex',   icon: '🇨🇭' },
  // Metals
  { symbol: 'XAUUSD', label: 'Gold/USD', type: 'metal', category: 'Metals',  icon: '🥇' },
  // Crypto
  { symbol: 'BTCUSD', label: 'BTC/USD', type: 'crypto', category: 'Crypto',  coingeckoId: 'bitcoin',     icon: '₿' },
  { symbol: 'ETHUSD', label: 'ETH/USD', type: 'crypto', category: 'Crypto',  coingeckoId: 'ethereum',    icon: 'Ξ' },
  { symbol: 'BNBUSD', label: 'BNB/USD', type: 'crypto', category: 'Crypto',  coingeckoId: 'binancecoin', icon: '◈' },
  { symbol: 'SOLUSD', label: 'SOL/USD', type: 'crypto', category: 'Crypto',  coingeckoId: 'solana',      icon: '◎' },
];

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h'];

// ── Live price fetch ──────────────────────────────────────────────

// TwelveData symbol → our internal symbol (forex only)
const TD_FOREX_QUOTE_MAP = {
  'EUR/USD': 'EURUSD',
  'USD/JPY': 'USDJPY',
  'GBP/USD': 'GBPUSD',
  'AUD/USD': 'AUDUSD',
  'USD/CHF': 'USDCHF',
};

/**
 * Fetch 24h change % for all forex pairs via TwelveData /quote.
 * Returns an object { EURUSD: 0.12, USDJPY: -0.34, ... } or {} if no key.
 *
 * Call rate: every 10 minutes (5 symbols × 144 cycles = 720 credits/day < 800 free limit)
 */
export async function fetchForexChanges() {
  const apiKey = import.meta.env.VITE_TWELVEDATA_API_KEY;
  if (!apiKey) return {};

  const pairs = Object.keys(TD_FOREX_QUOTE_MAP).join(',');
  try {
    const res  = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(pairs)}&apikey=${apiKey}`,
    );
    const data = await res.json();

    const result = {};
    // Multi-symbol response: { "EUR/USD": { percent_change: "0.123", ... }, ... }
    for (const [tdSym, quote] of Object.entries(data)) {
      const sym = TD_FOREX_QUOTE_MAP[tdSym];
      if (sym && quote.percent_change != null)
        result[sym] = parseFloat(quote.percent_change);
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchAllPrices() {
  const prices  = {};
  const changes = {};

  // ── Forex prices — Coinbase (free, no key) ────────────────────
  // Returns current rates only — 24h change is fetched separately by fetchForexChanges()
  try {
    const res  = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
    const data = await res.json();
    const r    = data.data?.rates || {};
    if (r.EUR) prices.EURUSD = parseFloat((1 / parseFloat(r.EUR)).toFixed(5));
    if (r.JPY) prices.USDJPY = parseFloat(parseFloat(r.JPY).toFixed(3));
    if (r.GBP) prices.GBPUSD = parseFloat((1 / parseFloat(r.GBP)).toFixed(5));
    if (r.AUD) prices.AUDUSD = parseFloat((1 / parseFloat(r.AUD)).toFixed(5));
    if (r.CHF) prices.USDCHF = parseFloat(parseFloat(r.CHF).toFixed(5));
  } catch { /* network error — skip */ }

  // ── Crypto + Gold — CoinGecko (free, no key) ─────────────────
  // pax-gold (PAXG) is pegged 1:1 to one troy oz of physical gold
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price' +
      '?ids=bitcoin,ethereum,binancecoin,solana,pax-gold' +
      '&vs_currencies=usd&include_24hr_change=true',
    );
    const cg = await res.json();
    if (cg.bitcoin)     { prices.BTCUSD = cg.bitcoin.usd;     changes.BTCUSD = cg.bitcoin.usd_24h_change;     }
    if (cg.ethereum)    { prices.ETHUSD = cg.ethereum.usd;    changes.ETHUSD = cg.ethereum.usd_24h_change;    }
    if (cg.binancecoin) { prices.BNBUSD = cg.binancecoin.usd; changes.BNBUSD = cg.binancecoin.usd_24h_change; }
    if (cg.solana)      { prices.SOLUSD = cg.solana.usd;      changes.SOLUSD = cg.solana.usd_24h_change;      }
    if (cg['pax-gold']) { prices.XAUUSD = cg['pax-gold'].usd; changes.XAUUSD = cg['pax-gold'].usd_24h_change; }
  } catch { /* network error — skip */ }

  return { prices, changes };
}

// ── Display utilities ─────────────────────────────────────────────

// Lightweight RSI from a short price-history array (scanner display only)
// For full Wilder's RSI used in TA, see technicalAnalysis.js
export function computeRSI(history, period = 14) {
  if (!history || history.length < period + 1) return null;
  const slice = history.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

export function formatPrice(symbol, price) {
  if (price == null) return '—';
  if (symbol === 'USDJPY') return price.toFixed(3);
  if (['XAUUSD', 'BTCUSD', 'ETHUSD'].includes(symbol))
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (['BNBUSD', 'SOLUSD'].includes(symbol)) return price.toFixed(2);
  return price.toFixed(5);
}
