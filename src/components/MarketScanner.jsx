import { useEffect, useRef, useCallback } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { INSTRUMENTS, TIMEFRAMES, fetchAllPrices, fetchForexChanges, computeRSI, formatPrice } from '../services/marketData';
import { TF_MINUTES, ANALYZABLE_SYMBOLS } from '../services/candles';

const PRICE_REFRESH_MS   =  30_000;   // 30 s — Coinbase + CoinGecko (free, no limit)
const CHANGE_REFRESH_MS  = 600_000;   // 10 min — TwelveData forex change (800 credits/day budget)
const SCAN_INTERVAL_MS   = 120_000;   // 2 min
const INITIAL_SCAN_DELAY =  15_000;

// All instruments that have at least one OHLCV source (Binance, TwelveData, or AlphaVantage)
// If an instrument's candle fetch fails at analysis time, BotEngine gates it with status='skipped'
const ANALYZABLE_INSTRUMENTS = INSTRUMENTS.filter(i => ANALYZABLE_SYMBOLS.has(i.symbol));

const SCAN_QUEUE = [];
ANALYZABLE_INSTRUMENTS.forEach(inst => TIMEFRAMES.forEach(tf => SCAN_QUEUE.push({ inst, tf })));

export default function MarketScanner({ onLog, onPricesUpdate, onScanStatus }) {
  const histRef       = useRef({});
  const scanIdxRef    = useRef(0);
  const busyRef       = useRef(false);
  const forexChgRef   = useRef({});   // persists forex 24h changes between fast refresh cycles

  /* ─── Forex 24h change (slow — TwelveData, 10-min budget) ─── */
  const refreshForexChanges = useCallback(async () => {
    const chg = await fetchForexChanges();
    if (Object.keys(chg).length > 0) {
      Object.assign(forexChgRef.current, chg);
    }
  }, []);

  /* ─── Price refresh (fast — Coinbase + CoinGecko, free) ─────── */
  const refreshPrices = useCallback(async () => {
    try {
      const { prices, changes } = await fetchAllPrices();

      Object.entries(prices).forEach(([sym, p]) => {
        if (!histRef.current[sym]) histRef.current[sym] = [];
        histRef.current[sym].push(p);
        if (histRef.current[sym].length > 50) histRef.current[sym].shift();
      });

      const rsiMap = {};
      INSTRUMENTS.forEach(({ symbol }) => {
        rsiMap[symbol] = computeRSI(histRef.current[symbol]);
      });

      // Merge: CoinGecko crypto/gold changes + persisted forex changes (from slow timer)
      const mergedChanges = { ...forexChgRef.current, ...changes };

      onPricesUpdate({ prices, changes: mergedChanges, rsi: rsiMap });
      const n = Object.keys(prices).length;
      if (n > 0) onLog(`📊 Market data refreshed — ${n} instruments live`);
    } catch (err) {
      onLog(`⚠️ Price fetch error: ${err.message}`);
    }
  }, [onLog, onPricesUpdate]);

  /* ─── Single scan step (analyzable symbols only) ─────────── */
  const runScan = useCallback(async () => {
    if (busyRef.current) return;

    const { inst, tf } = SCAN_QUEUE[scanIdxRef.current % SCAN_QUEUE.length];
    scanIdxRef.current++;

    const history = histRef.current[inst.symbol];
    if (!history?.length) {
      onLog(`⏳ No price yet for ${inst.label} — skipping`);
      return;
    }

    const price  = history[history.length - 1];
    const rsi    = computeRSI(history);
    const rsiStr = rsi != null ? ` | RSI: ${rsi}` : '';

    busyRef.current = true;
    onScanStatus({ symbol: inst.label, timeframe: tf, status: 'scanning' });
    onLog(`🔍 Scanning ${inst.label} · ${tf} → ${formatPrice(inst.symbol, price)}${rsiStr}`);

    try {
      // RSI-based direction bias; alternates when RSI is neutral
      let signal;
      if (rsi != null) {
        if      (rsi < 40) signal = 'LONG';
        else if (rsi > 60) signal = 'SHORT';
        else               signal = scanIdxRef.current % 2 === 0 ? 'LONG' : 'SHORT';
      } else {
        signal = scanIdxRef.current % 2 === 0 ? 'LONG' : 'SHORT';
      }

      onScanStatus({ symbol: inst.label, timeframe: tf, status: 'analyzing' });

      await addDoc(collection(db, 'alerts'), {
        symbol:    inst.symbol,
        exchange:  inst.type === 'crypto' ? 'Crypto' : 'Spot',
        timeframe: TF_MINUTES[tf],
        signal,
        strategy:  'Auto-Scanner',
        close:     price,
        price,
        rsi:       rsi ?? null,
        volume:    null,
        status:    'pending',
        source:    'market-scanner',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      onLog(`❌ Scan failed for ${inst.label}: ${err.message}`);
    } finally {
      setTimeout(() => {
        busyRef.current = false;
        onScanStatus(null);
      }, 6_000);
    }
  }, [onLog, onScanStatus]);

  /* ─── Boot ───────────────────────────────────────────────── */
  useEffect(() => {
    const allLabels = ANALYZABLE_INSTRUMENTS.map(i => i.label).join(', ');
    const unrouted  = INSTRUMENTS.filter(i => !ANALYZABLE_SYMBOLS.has(i.symbol)).map(i => i.label);

    onLog(`🚀 Market Scanner starting up...`);
    onLog(`🔬 Scan queue: ${ANALYZABLE_INSTRUMENTS.length} instruments × ${TIMEFRAMES.length} timeframes = ${SCAN_QUEUE.length} slots`);
    onLog(`   Sources: Binance (crypto/gold) · TwelveData (forex+all) · AlphaVantage (forex fallback)`);
    onLog(`   Instruments: ${allLabels}`);
    if (unrouted.length) onLog(`👁️  Monitor only (no OHLCV source): ${unrouted.join(', ')}`);
    onLog(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')} · Scan every 2 min`);

    refreshForexChanges();                                          // immediate first fetch
    refreshPrices();
    const priceTimer  = setInterval(refreshPrices, PRICE_REFRESH_MS);
    const changeTimer = setInterval(refreshForexChanges, CHANGE_REFRESH_MS);
    const firstScan   = setTimeout(runScan, INITIAL_SCAN_DELAY);
    const scanTimer   = setInterval(runScan, SCAN_INTERVAL_MS);

    return () => {
      clearInterval(priceTimer);
      clearInterval(changeTimer);
      clearInterval(scanTimer);
      clearTimeout(firstScan);
    };
  }, [onLog, refreshForexChanges, refreshPrices, runScan]);

  return null;
}
