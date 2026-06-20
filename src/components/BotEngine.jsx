import { useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { analyzeTradeSignal, KEY_POOL_SIZE, STRATEGY_RULES } from '../services/gemini';
import { sendTelegramMessage, buildApprovedMessage } from '../services/telegram';
import { fetchCandles } from '../services/candles';
import { buildTechnicalSummary } from '../services/technicalAnalysis';

const CONFIDENCE_THRESHOLD = 75;

// Strategy-aware risk engine — each strategy has its own minimum R:R
function runRiskEngine(analysis) {
  const rejections = [];
  const strategy   = analysis.strategy || 'day_trading';
  const minRR      = STRATEGY_RULES[strategy]?.minRR ?? 2.0;

  if (analysis.confidence < CONFIDENCE_THRESHOLD)
    rejections.push(`Confidence ${analysis.confidence}% below ${CONFIDENCE_THRESHOLD}%`);
  if (analysis.risk_reward < minRR)
    rejections.push(`R:R ${analysis.risk_reward} below ${minRR} min (${strategy.replace('_', ' ')})`);

  return { passed: rejections.length === 0, rejections };
}

// All timeframes fetched in parallel for every analysis
const ALL_TFS = ['1m', '5m', '15m', '30m', '1h'];

export default function BotEngine({ onLog, onPipelineUpdate }) {
  useEffect(() => {
    const push = (data) => onPipelineUpdate?.(data);
    const q    = query(collection(db, 'alerts'), where('status', '==', 'pending'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;

        const alertData = change.doc.data();
        const alertRef  = doc(db, 'alerts', change.doc.id);

        await updateDoc(alertRef, { status: 'processing' });

        // ── Stage 1: Received ───────────────────────────────────
        push({ stage: 'received', alert: alertData });

        const src    = alertData.source === 'market-scanner' ? '🔄 Auto-scan' : '📡 Webhook';
        const sig    = alertData.signal ? ` · ${alertData.signal}` : '';
        const price  = alertData.close ?? alertData.price;
        onLog(`${src}: ${alertData.symbol}${sig} @ ${price}`);

        try {
          // ── Fetch ALL timeframes in parallel ─────────────────
          onLog(`📈 Fetching ${alertData.symbol} candles across ${ALL_TFS.length} timeframes...`);

          const settled = await Promise.allSettled(
            ALL_TFS.map(async (tf) => {
              const { candles, source } = await fetchCandles(alertData.symbol, tf, 200);
              if (!candles || candles.length < 50) return null;
              const summary = buildTechnicalSummary(candles, source ?? 'Unknown');
              if (!summary) return null;
              return { tf, summary, barCount: candles.length, source };
            }),
          );

          const tfSummaries = settled
            .map(r => r.status === 'fulfilled' ? r.value : null)
            .filter(Boolean);

          // Hard gate — need at least one TF with real data
          if (tfSummaries.length === 0) {
            onLog(`⛔ ${alertData.symbol}: no OHLCV data on any timeframe — skipping`);
            await updateDoc(alertRef, { status: 'skipped', reason: 'no_ohlcv_data' });
            push(null);
            return;
          }

          // Log what we have
          const tfLine = tfSummaries.map(r => `${r.tf}(${r.barCount}bars)`).join(' · ');
          onLog(`📊 Data ready: ${tfLine}`);
          tfSummaries.forEach(({ tf, summary: s }) => {
            const emaDir = s.ema.ema9 && s.ema.ema20
              ? (s.ema.ema9 > s.ema.ema20 ? '▲' : '▼') : '?';
            onLog(`   ${tf}: RSI=${s.rsi ?? 'N/A'} · ${s.trend} · EMA ${emaDir} · ATR=${s.atr?.toFixed(5) ?? 'N/A'}`);
          });

          // ── Stage 2: Gemini multi-TF analysis ────────────────
          push({ stage: 'gemini', alert: alertData });
          onLog(`🧠 Sending ${tfSummaries.length}-TF data to Gemini (${KEY_POOL_SIZE} key pool)...`);

          const analysis = await analyzeTradeSignal(alertData, tfSummaries, {
            onRotate: (from, to, total) =>
              onLog(`⚠️ Gemini key ${from}/${total} quota hit — switching to key ${to}`),
          });

          const strategy = analysis.strategy || 'day_trading';
          const stratLabel = STRATEGY_RULES[strategy]?.label ?? strategy.toUpperCase();

          onLog(`🧠 Gemini → ${stratLabel} on ${analysis.recommended_timeframe ?? '?'} · ${analysis.direction}`);
          onLog(`   Conf: ${analysis.confidence}% · Risk: ${analysis.risk_rating?.toUpperCase()} · R:R: ${analysis.risk_reward}`);
          if (analysis.confidence_breakdown) {
            const cb = analysis.confidence_breakdown;
            onLog(`   Breakdown: Trend=${cb.trend_analysis}% Vol=${cb.volume_analysis}% Mom=${cb.momentum}% Struct=${cb.market_structure}%`);
          }
          if (analysis.entry?.price)
            onLog(`   Entry: ${analysis.entry.price} (${analysis.entry.type})`);
          if (analysis.stop_loss?.price)
            onLog(`   SL: ${analysis.stop_loss.price} (${analysis.stop_loss.pips ?? '?'}p) — ${analysis.stop_loss.reasoning}`);
          const tps = analysis.take_profits || [];
          if (tps.length)
            onLog(`   TPs: ${tps.map(t => `TP${t.level}=${t.price}(${t.pips ?? '?'}p)`).join(' · ')}`);
          if (analysis.mtf_confluence)
            onLog(`   ⚡ MTF: "${analysis.mtf_confluence}"`);
          if (analysis.summary)
            onLog(`   💬 "${analysis.summary}"`);

          // ── Stage 3: Risk engine ──────────────────────────────
          push({ stage: 'risk', alert: alertData, analysis });
          const risk   = runRiskEngine(analysis);
          const minRR  = STRATEGY_RULES[strategy]?.minRR ?? 2.0;
          const confOk = analysis.confidence >= CONFIDENCE_THRESHOLD;
          const rrOk   = analysis.risk_reward >= minRR;
          onLog(`⚖️ ${stratLabel} risk: conf ${analysis.confidence}% ${confOk ? '✓' : '✗'} · R:R ${analysis.risk_reward} vs ${minRR} ${rrOk ? '✓' : '✗'}`);

          const analysisRef = await addDoc(collection(db, 'analysis'), {
            alertId:               change.doc.id,
            symbol:                alertData.symbol,
            signal:                analysis.direction || alertData.signal || null,
            strategy:              strategy,
            recommended_timeframe: analysis.recommended_timeframe || null,
            timeframe:             null,   // multi-TF — no single trigger TF
            exchange:              alertData.exchange || null,
            price:                 parseFloat(alertData.close || alertData.price || 0),
            rsi:                   alertData.rsi ? parseFloat(alertData.rsi) : null,
            analysis,
            riskPassed:            risk.passed,
            riskRejections:        risk.rejections,
            outcome:               null,
            pnl:                   null,
            outcomeNote:           null,
            closedAt:              null,
            createdAt:             serverTimestamp(),
          });

          // ── Stage 4: Telegram (approved only) ────────────────
          if (risk.passed) {
            try {
              push({ stage: 'telegram', alert: alertData, analysis, risk });
              onLog(`📨 Sending Telegram...`);
              await sendTelegramMessage(buildApprovedMessage(alertData, analysis));
              onLog(`📨 Telegram sent — ${alertData.symbol} ${stratLabel} ${analysis.direction}`);
            } catch (telErr) {
              onLog(`⚠️ Telegram failed: ${telErr.message}`);
            }
          } else {
            onLog(`🔕 Telegram skipped — ${risk.rejections.join(' · ')}`);
          }

          await updateDoc(alertRef, {
            status:      risk.passed ? 'approved' : 'rejected',
            analysisId:  analysisRef.id,
            processedAt: serverTimestamp(),
          });

          // ── Stage 5: Done ─────────────────────────────────────
          push({ stage: 'done', alert: alertData, analysis, risk });
          const verdict = risk.passed
            ? `✅ APPROVED — ${stratLabel} ${analysis.direction} conf:${analysis.confidence}% R:R:${analysis.risk_reward}`
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
