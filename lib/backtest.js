import fs from 'node:fs';
import path from 'node:path';
import { CFG, pairMeta } from './config.js';
import { UNIVERSE } from './universe.js';
import { computeIndicators, signalAt, sizePosition, floorTick } from './strategy.js';
import { periodMetrics, tradeStats, maxDrawdown } from './metrics.js';
import { wibDateKey } from './time.js';

export const TF_MS = 240 * 60 * 1000;

export function readCandles(file) {
  const txt = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const out = [];
  for (let i = 1; i < txt.length; i++) {
    const [Time, Open, High, Low, Close, Volume] = txt[i].split(',').map(Number);
    out.push({ Time, Open, High, Low, Close, Volume });
  }
  return out;
}

export function loadDepthSummary(root = process.cwd()) {
  const f = path.join(root, 'data', 'depth', 'summary.json');
  if (!fs.existsSync(f)) return { pairs: {}, generatedAt: null };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function loadData(root = process.cwd(), cfg = CFG) {
  const raw = path.join(root, 'data', 'raw');
  const depth = loadDepthSummary(root);
  const pairs = [];
  for (const u of UNIVERSE) {
    const file = path.join(raw, `${u.pair}_240.csv`);
    if (!fs.existsSync(file)) throw new Error('Data belum ada: ' + file);
    const bars = readCandles(file);
    const ind = computeIndicators(bars, cfg);
    const d = depth.pairs?.[u.pair] || {};
    const spreadBps = Number.isFinite(d.spreadBps) ? d.spreadBps : 10;
    const buySlip = d.buySlipBps?.[25_000_000];
    const sellSlip = d.sellSlipBps?.[25_000_000];
    pairs.push({
      u,
      bars,
      ind,
      halfSpread: spreadBps / 2 / 10000,
      buySlip: (Number.isFinite(buySlip) ? buySlip : 5) / 10000,
      sellSlip: (Number.isFinite(sellSlip) ? sellSlip : 5) / 10000,
      idxByTime: new Map(bars.map((b, i) => [b.Time * 1000, i])),
    });
  }
  const timeline = [...new Set(pairs.flatMap((p) => p.bars.map((b) => b.Time * 1000)))].sort((a, b) => a - b);
  return { pairs, timeline, depth };
}

function buyCosts(mid, halfSpread, slip) {
  return { price: mid * (1 + halfSpread + slip), spread: mid * halfSpread, slip: mid * slip };
}

function sellCosts(mid, halfSpread, slip) {
  return { price: mid * (1 - halfSpread - slip), spread: mid * halfSpread, slip: mid * slip };
}

export function runBacktest(data, {
  startMs,
  endMs,
  cfg = CFG,
  entryMode = cfg.entryMode,
  isolated = true,
} = {}) {
  const pairs = data.pairs;
  const pByPair = new Map(pairs.map((p) => [p.u.pair, p]));
  const cash0 = cfg.startEquity;
  let cash = cash0;
  const positions = new Map();
  const pending = new Map();
  const cooldownUntil = new Map();
  const trades = [];
  const signals = [];
  const equityPoints = [];
  let day = { date: wibDateKey(startMs), startEquity: cash0, blocked: false };
  let lastEquity = cash0;

  equityPoints.push({ ts: startMs, equity: cash0, cash: cash0, invested: 0, nPos: 0 });

  const markEquity = (priceByPair) => {
    let v = cash;
    let inv = 0;
    for (const [pair, pos] of positions) {
      const px = priceByPair.get(pair);
      if (px > 0) {
        const val = pos.qty * px;
        v += val;
        inv += val;
      }
    }
    return { v, inv };
  };

  const closePos = (pair, pos, basePrice, ts, index, reason, p) => {
    const c = sellCosts(basePrice, p.halfSpread, p.sellSlip);
    const notional = pos.qty * c.price;
    const feeSell = notional * cfg.feeSell;
    cash += notional - feeSell;
    const netPnl = notional - feeSell - pos.cost;
    const t = {
      pair,
      entryTs: pos.entryTs,
      exitTs: ts,
      entryPrice: pos.entryPrice,
      exitPrice: c.price,
      qty: pos.qty,
      entryNotional: pos.notional,
      exitNotional: notional,
      feeBuy: pos.feeBuy,
      feeSell,
      spreadCost: pos.spreadCost + pos.qty * c.spread,
      slipCost: pos.slipCost + pos.qty * c.slip,
      netPnl,
      ret: netPnl / pos.cost,
      reason,
      holdBars: index - pos.entryIndex,
    };
    trades.push(t);
    positions.delete(pair);
    cooldownUntil.set(pair, index + cfg.cooldownBars);
  };

  for (const ts of data.timeline) {
    if (ts < startMs || ts > endMs) continue;
    const barAt = new Map();
    const openAt = new Map();
    for (const p of pairs) {
      const i = p.idxByTime.get(ts);
      if (i == null) continue;
      barAt.set(p.u.pair, { p, i, bar: p.bars[i] });
      openAt.set(p.u.pair, p.bars[i].Open);
    }
    if (!barAt.size) continue;

    const eqOpen = markEquity(openAt).v;
    if (wibDateKey(ts) !== day.date) day = { date: wibDateKey(ts), startEquity: eqOpen, blocked: false };
    if (eqOpen < day.startEquity * (1 - cfg.dailyLossLimit)) day.blocked = true;

    // 1. exit waktu + stop pada open/low
    for (const [pair, pos] of [...positions]) {
      const rec = barAt.get(pair);
      if (!rec) continue;
      const { p, i, bar } = rec;
      if (i - pos.entryIndex >= cfg.maxHoldBars) {
        closePos(pair, pos, bar.Open, ts, i, 'waktu', p);
        continue;
      }
      if (bar.Low <= pos.stop) {
        const base = Math.min(bar.Open, pos.stop);
        closePos(pair, pos, base, ts, i, bar.Open < pos.stop ? 'stop_gap' : 'stop', p);
      }
    }

    // 2. pending order: limit / market
    for (const [pair, ord] of [...pending]) {
      const rec = barAt.get(pair);
      if (!rec) continue;
      const { p, i, bar } = rec;
      if (day.blocked) {
        pending.delete(pair);
        signals.push({ ts: new Date(ts).toISOString(), pair, action: 'cancel', reason: 'daily_loss_limit' });
        continue;
      }
      if (ord.mode === 'market') {
        const c = buyCosts(bar.Open, p.halfSpread, p.buySlip);
        const sz = sizePosition({ equity: eqOpen, cash, price: c.price, atr: ord.atr, tick: p.u.tick, qtyStep: p.u.qtyStep, cfg });
        if (sz) {
          const notional = sz.qty * c.price;
          const feeBuy = notional * cfg.feeBuy;
          cash -= notional + feeBuy;
          const cost = notional + feeBuy;
          positions.set(pair, {
            qty: sz.qty, entryPrice: c.price, entryTs: ts, entryIndex: i, notional, feeBuy,
            spreadCost: sz.qty * c.spread, slipCost: sz.qty * c.slip, cost, stop: c.price - sz.stopDist, atr: ord.atr,
          });
          signals.push({ ts: new Date(ts).toISOString(), pair, action: 'buy_market', price: c.price, qty: sz.qty, index: i });
        } else {
          signals.push({ ts: new Date(ts).toISOString(), pair, action: 'cancel', reason: 'size', index: i });
        }
        pending.delete(pair);
        continue;
      }

      const filled = bar.Low < ord.limit;
      if (filled) {
        const base = Math.min(bar.Open, ord.limit);
        const mid = bar.Open;
        const spreadCost = Math.max(0, base - mid);
        const sz = sizePosition({ equity: eqOpen, cash, price: base, atr: ord.atr, tick: p.u.tick, qtyStep: p.u.qtyStep, cfg });
        if (sz) {
          const notional = sz.qty * base;
          const feeBuy = notional * cfg.feeBuy;
          cash -= notional + feeBuy;
          positions.set(pair, {
            qty: sz.qty, entryPrice: base, entryTs: ts, entryIndex: i, notional, feeBuy,
            spreadCost: sz.qty * spreadCost, slipCost: 0, cost: notional + feeBuy,
            stop: base - sz.stopDist, atr: ord.atr,
          });
          signals.push({ ts: new Date(ts).toISOString(), pair, action: 'buy_limit', price: base, qty: sz.qty, index: i });
        } else {
          signals.push({ ts: new Date(ts).toISOString(), pair, action: 'cancel', reason: 'size', index: i });
        }
        pending.delete(pair);
        continue;
      }
      if (i >= ord.expiresIndex || bar.Close > ord.cSig * (1 + cfg.runaway)) {
        pending.delete(pair);
        signals.push({ ts: new Date(ts).toISOString(), pair, action: 'cancel', reason: i >= ord.expiresIndex ? 'ttl' : 'runaway', index: i });
      }
    }

    // 3. sinyal baru di close bar
    for (const [pair, rec] of barAt) {
      const { p, i, bar } = rec;
      if (positions.has(pair) || pending.has(pair)) continue;
      if ((cooldownUntil.get(pair) ?? -1) > i) continue;
      if (positions.size + pending.size >= cfg.maxPositions) continue;
      if (day.blocked) continue;
      const sig = signalAt(p.ind, i, { ...cfg, entryMode }, p.u.tick);
      if (!sig) continue;
      if (sig.mode === 'market') {
        pending.set(pair, { mode: 'market', atr: sig.atr, cSig: sig.close, iSig: i, expiresIndex: i + 1 });
      } else {
        pending.set(pair, {
          mode: 'limit', limit: sig.limit, atr: sig.atr, cSig: sig.close,
          iSig: i, expiresIndex: i + cfg.ttlBars,
        });
      }
      signals.push({
        ts: new Date((bar.Time * 1000) + TF_MS).toISOString(), pair, action: 'signal', mode: sig.mode,
        limit: sig.limit, atr: sig.atr, close: sig.close, index: i, candle: bar.Time,
      });
    }

    // 4. mark equity di close, nilai posisi pada bid
    const closeBid = new Map();
    for (const [pair, rec] of barAt) closeBid.set(pair, rec.bar.Close * (1 - rec.p.halfSpread));
    const eq = markEquity(closeBid);
    lastEquity = eq.v;
    equityPoints.push({ ts: ts + TF_MS, equity: eq.v, cash, invested: eq.inv, nPos: positions.size });
  }

  // posisi terbuka ditandai pada bid terakhir, tidak dilikuidasi paksa
  return {
    trades,
    signals,
    equityPoints,
    positions: [...positions.entries()].map(([pair, p]) => ({ pair, ...p })),
    cash,
    endEquity: lastEquity,
    pending: [...pending.keys()],
  };
}

export function benchmarkBTC(data, { startMs, endMs, cfg = CFG }) {
  const p = data.pairs.find((x) => x.u.pair === 'btc_idr');
  if (!p) return null;
  const bars = p.bars.filter((b) => b.Time * 1000 >= startMs && b.Time * 1000 <= endMs);
  if (!bars.length) return null;
  const first = bars[0];
  const c = buyCosts(first.Open, p.halfSpread, p.buySlip);
  const qty = cfg.startEquity / (c.price * (1 + cfg.feeBuy));
  const entryFee = qty * c.price * cfg.feeBuy;
  const points = bars.map((b) => ({
    ts: b.Time * 1000 + TF_MS,
    equity: qty * b.Close * (1 - p.halfSpread),
  }));
  const last = bars[bars.length - 1];
  const exitVal = qty * last.Close * (1 - p.halfSpread) * (1 - cfg.feeSell);
  return {
    pair: 'btc_idr',
    qty,
    entryFee,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    totalReturn: exitVal / cfg.startEquity - 1,
    endEquity: exitVal,
    points,
  };
}

export function summarizeRun(run, { startMs, endMs, cfg = CFG, data }) {
  const m = periodMetrics({
    startEquity: cfg.startEquity,
    points: run.equityPoints,
    trades: run.trades,
    startMs,
    endMs,
  });
  const bench = benchmarkBTC(data, { startMs, endMs, cfg });
  return {
    ...m,
    trades: run.trades,
    signals: run.signals,
    equity: run.equityPoints,
    openPositions: run.positions,
    benchmark: bench
      ? {
          totalReturn: bench.totalReturn,
          endEquity: bench.endEquity,
          pair: bench.pair,
          mdd: maxDrawdown(bench.points).mdd,
        }
      : null,
    benchmarkPoints: bench?.points || [],
  };
}
