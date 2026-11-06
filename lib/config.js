import { UNIVERSE, UNIVERSE_META } from './universe.js';

const num = (v, d) => (v == null || v === '' || Number.isNaN(+v) ? d : +v);

// Parameter strategi FINN 02 versi kripto 4 jam.
// Semua angka dibekukan pada commit freeze dan tidak diubah setelahnya.
export const CFG = {
  timeframe: '240',
  tfMs: 240 * 60 * 1000,

  // Indikator
  hhvN: 20,
  maN: 50,
  atrN: 14,
  turnoverN: 20,

  // Entry
  entryMode: process.env.ENTRY_MODE || 'limit', // limit | break | both
  limitAtr: 1.1,
  ttlBars: 5,
  runaway: 0.12,
  strongAtr: 1.0,

  // Exit: hanya harga dan waktu
  stopAtr: 5.0,
  maxHoldBars: 120,

  // Portofolio
  startEquity: num(process.env.PAPER_EQUITY, 100_000_000),
  riskPerTrade: 0.01,
  maxPositions: 5,
  maxPerName: 0.2,
  cooldownBars: 5,
  minOrderIdr: 25_000,

  // Risiko harian (WIB)
  dailyLossLimit: 0.03,

  // Biaya taker all-in resmi IDR PRO, berlaku 1 Okt 2026.
  // Sumber: help.indodax.com artikel Rincian Biaya Transaksi (diakses 2026-11-06)
  // dan /api/pairs trade_fee_percent_taker = 0.2%. Dipakai yang lebih mahal.
  feeBuy: 0.0020555,
  feeSell: 0.0041555,

  // Filter likuiditas dan data
  minTurnover20: 500_000_000, // Rp 500 juta per bar 4 jam (median 20 bar)
  maxSpreadBps: 200, // 2%
  minBars: 120,
  minClosedAgeMs: 0,

  // Endpoint / batas
  apiBase: 'https://indodax.com',
  maxRequestsPerSec: 3,

  pairs: UNIVERSE,
  universeMeta: UNIVERSE_META,
};

export function pairMeta(pair) {
  const p = CFG.pairs.find((x) => x.pair === pair);
  if (!p) throw new Error('Pair tidak ada di universe beku: ' + pair);
  return p;
}

export function universePairs() {
  return CFG.pairs.map((p) => p.pair);
}
