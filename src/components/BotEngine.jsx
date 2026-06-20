import { useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { analyzeTradeSignal } from '../services/gemini';
import { sendTelegramMessage, buildApprovedMessage } from '../services/telegram';
import { fetchCandles, TF_MINUTES } from '../services/candles';
import { buildTechnicalSummary } from '../services/technicalAnalysis';

const CONFIDENCE_THRESHOLD  = 75;
const RISK_REWARD_THRESHOLD = 2;

function runRiskEngine(analysis) {
  const rejections = [];
  if (analysis.confidence < CONFIDENCE_THRESHOLD)
    rejections.push(`Confidence ${analysis.confidence}% below ${CONFIDENCE_THRESHOLD}%`);
  if (analysis.risk_reward < RISK_REWARD_THRESHOLD)
    rejections.push(`R:R ${analysis.risk_reward} below ${RISK_REWARD_THRESHOLD}`);
  return { passed: rejections.length === 0, rejections };
}

// Resolve timeframe label from minutes number (e.g. 15 → '15m')
function tfLabel(minutes) {
  return Object.entries(TF_MINUTES).find(([, m]) => m === minutes)?.[0] ?? `${minutes}m`;
}

export default function BotEngine({ onLog, onPipelineUpdate }) {
  useEffect(() => {
    const push = (data) => onPipelineUpdate?.(data);
    const q = query(collection(db, 'alerts'), where('status', '==', 'pending'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;

        const alertData = change.doc.data();
        const alertRef  = doc(db, 'alerts', change.doc.id);

        await updateDoc(alertRef, { status: 'processing' });

        // ── Stage 1: Received ───────────────────────────────────
        push({ stage: 'received', alert: alertData });

        const src   = alertData.source === 'market-scanner' ? '🔄 Auto-scan' : '📡 Webhook';
        const tf    = alertData.timeframe ? ` ${alertData.timeframe}m` : '';
        const sig   = alertData.signal ? ` · ${alertData.signal}` : '';
        const price = alertData.close ?? alertData.price;
        const rsiStr = alertData.rsi != null ? ` · RSI: ${alertData.rsi}` : '';
        onLog(`${src}: ${alertData.symbol}${tf}${sig} @ ${price}${rsiStr}`);
        onLog(`   Exchange: ${alertData.exchange || '—'} · Strategy: ${alertData.strategy || '—'}`);

        try {
          // ── Fetch OHLCV candles — REQUIRED before Gemini ────────
          const tf_str = alertData.timeframe ? tfLabel(alertData.timeframe) : '15m';

          onLog(`📈 Fetching ${alertData.symbol} OHLCV candles (${tf_str}, 200 bars)...`);
          let candles = null;
          let candleSource = null;
          try {
            const result = await fetchCandles(alertData.symbol, tf_str, 200);
            candles      = result.candles;
            candleSource = result.source;
          } catch (candleErr) {
            onLog(`⛔ Candle fetch failed for ${alertData.symbol}: ${candleErr.message} — analysis aborted`);
          }

          // Hard gate: no real OHLCV data = no analysis
          if (!candles || candles.length < 50) {
            onLog(`⛔ ${alertData.symbol}: insufficient OHLCV data (${candles?.length ?? 0} bars, need ≥50) — skipping`);
            await updateDoc(alertRef, { status: 'skipped', reason: 'insufficient_ohlcv' });
            push(null);
            return;
          }

          const technicalSummary = buildTechnicalSummary(candles, candleSource ?? 'Unknown');

          if (!technicalSummary) {
            onLog(`⛔ ${alertData.symbol}: technical summary failed — skipping`);
            await updateDoc(alertRef, { status: 'skipped', reason: 'summary_build_failed' });
            push(null);
            return;
          }

          // Log computed indicators
          const s = technicalSummary;
          onLog(`📈 ${candles.length} candles — RSI: ${s.rsi ?? 'N/A'} · Trend: ${s.trend} · ATR: ${s.atr?.toFixed(5) ?? 'N/A'}`);
          if (s.ema.ema20 && s.ema.ema50) {
            const align = s.ema.ema9 > s.ema.ema20 && s.ema.ema20 > s.ema.ema50 ? 'BULLISH' :
                          s.ema.ema9 < s.ema.ema20 && s.ema.ema20 < s.ema.ema50 ? 'BEARISH' : 'MIXED';
            onLog(`   EMA(9/20/50): ${align}`);
          }
          if (s.macd) {
            const dir = s.macd.histogram > 0 ? '▲' : '▼';
            onLog(`   MACD hist: ${dir} ${s.macd.histogram.toFixed(6)}${s.macd.crossover ? ' ← CROSSOVER' : s.macd.crossunder ? ' ← CROSSUNDER' : ''}`);
          }
          if (s.bollinger)
            onLog(`   BB %B: ${s.bollinger.pct_b.toFixed(1)}% · width: ${s.bollinger.width_pct.toFixed(2)}%`);
          if (s.key_levels.resistance.length || s.key_levels.support.length) {
            const res = s.key_levels.resistance.map(v => v.toFixed(5)).join(' / ');
            const sup = s.key_levels.support.map(v => v.toFixed(5)).join(' / ');
            onLog(`   Resistance: ${res || '—'} · Support: ${sup || '—'}`);
          }

          // ── Stage 2: Gemini ─────────────────────────────────────
          push({ stage: 'gemini', alert: alertData });
          onLog(`🧠 Full data confirmed — sending to Gemini-2.5-Flash...`);

          const analysis = await analyzeTradeSignal(alertData, technicalSummary);

          const tp1 = analysis.take_profits?.[0]?.price;
          const tp2 = analysis.take_profits?.[1]?.price;
          const tp3 = analysis.take_profits?.[2]?.price;

          onLog(`🧠 Gemini output for ${alertData.symbol}:`);
          onLog(`   Confidence: ${analysis.confidence}% · Risk: ${analysis.risk_rating?.toUpperCase()} · R:R: ${analysis.risk_reward}`);
          if (analysis.entry?.price)
            onLog(`   Entry: ${analysis.entry.price} (${analysis.entry.type}) · Zone: ${analysis.entry.zone_low}–${analysis.entry.zone_high}`);
          if (analysis.stop_loss?.price)
            onLog(`   SL: ${analysis.stop_loss.price} — ${analysis.stop_loss.reasoning}`);
          if (tp1) onLog(`   TP1: ${tp1}${tp2 ? ` · TP2: ${tp2}` : ''}${tp3 ? ` · TP3: ${tp3}` : ''}`);
          if (analysis.trade_management?.max_hold_time)
            onLog(`   Hold: ${analysis.trade_management.max_hold_time} · Invalidation: ${analysis.trade_management.invalidation}`);
          if (analysis.summary)
            onLog(`   💬 "${analysis.summary}"`);

          // ── Stage 3: Risk engine ────────────────────────────────
          push({ stage: 'risk', alert: alertData, analysis });
          const confOk = analysis.confidence >= CONFIDENCE_THRESHOLD;
          const rrOk   = analysis.risk_reward  >= RISK_REWARD_THRESHOLD;
          onLog(`⚖️ Risk check: conf ${analysis.confidence}% ${confOk ? '✓' : '✗'} · R:R ${analysis.risk_reward} ${rrOk ? '✓' : '✗'}`);

          const risk = runRiskEngine(analysis);

          const analysisRef = await addDoc(collection(db, 'analysis'), {
            alertId:        change.doc.id,
            symbol:         alertData.symbol,
            signal:         alertData.signal || null,
            strategy:       alertData.strategy || null,
            timeframe:      alertData.timeframe || null,
            exchange:       alertData.exchange || null,
            price:          parseFloat(alertData.close || alertData.price || 0),
            rsi:            alertData.rsi ? parseFloat(alertData.rsi) : null,
            analysis,
            riskPassed:     risk.passed,
            riskRejections: risk.rejections,
            outcome:        null,
            pnl:            null,
            outcomeNote:    null,
            closedAt:       null,
            createdAt:      serverTimestamp(),
          });

          // ── Stage 4: Telegram (approved trades only) ────────────
          if (risk.passed) {
            try {
              push({ stage: 'telegram', alert: alertData, analysis, risk });
              onLog(`📨 Sending Telegram notification...`);
              await sendTelegramMessage(buildApprovedMessage(alertData, analysis));
              onLog(`📨 Telegram sent for ${alertData.symbol}`);
            } catch (telErr) {
              onLog(`⚠️ Telegram failed: ${telErr.message}`);
            }
          } else {
            onLog(`🔕 Telegram skipped — trade rejected, no notification sent`);
          }

          await updateDoc(alertRef, {
            status:      risk.passed ? 'approved' : 'rejected',
            analysisId:  analysisRef.id,
            processedAt: serverTimestamp(),
          });

          // ── Stage 5: Done ───────────────────────────────────────
          push({ stage: 'done', alert: alertData, analysis, risk });

          const verdict = risk.passed
            ? `✅ APPROVED — conf: ${analysis.confidence}%, R:R: ${analysis.risk_reward}`
            : `🚫 REJECTED — ${risk.rejections.join(' · ')}`;
          onLog(`${alertData.symbol}: ${verdict}`);
          onLog(`─────────────────────────────────────────────`);

          setTimeout(() => push(null), 10_000);

        } catch (err) {
          console.error('BotEngine error:', err);
          onLog(`❌ Error on ${alertData.symbol}: ${err.message}`);
          push({ stage: 'error', alert: alertData, error: err.message });
          setTimeout(() => push(null), 6_000);
          await updateDoc(alertRef, { status: 'failed', error: err.message });
        }
      });
    });

    return () => unsubscribe();
  }, [onLog, onPipelineUpdate]);

  return null;
}
