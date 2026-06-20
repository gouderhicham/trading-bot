import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

try {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });

  const db = getFirestore();
  const payload = {
    symbol: "BTCUSDT",
    exchange: "BINANCE",
    timeframe: "15",
    close: "104500",
    volume: "2341",
    strategy: "TEST",
    signal: "LONG",
    rsi: "32"
  };

  await db.collection('alerts').add({
    ...payload,
    receivedAt: FieldValue.serverTimestamp(),
    status: 'pending',
  });

  console.log('Fake signal successfully added to Firestore! Check your dashboard.');
  process.exit(0);
} catch (e) {
  console.error("Error inserting fake signal:", e);
  process.exit(1);
}
