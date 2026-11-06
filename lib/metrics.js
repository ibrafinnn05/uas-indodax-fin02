import { wibDateKey, TF_MS } from './time.js';

export function maxDrawdown(points) {
  let peak = -Infinity;
  let mdd = 0;
  let peakTs = null;
  let troughTs = null;
  let curPeakTs = null;
  for (const p of points) {
    const v = +p.equity;
    if (!(v > 0)) continue;
    if (v > peak) {
      peak = v;
      curPeakTs = p.ts;
    }
    const dd = v / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      peakTs = curPeakTs;
      troughTs = p.ts;
    }
  }
  return { mdd, peakTs, troughTs };
}

export function dailyPoints(points) {
  const map = new Map();
  for (const p of points) {
    const d = wibDateKey(p.ts);
    map.set(d, p); // terakhir di hari itu
  }
  return [...map.entries()].map(([date, p]) => ({ date, ts: p.ts, equity: p.equity }));
}

export function sharpeDaily(points) {
  const d = dailyPoints(points);
  if (d.length < 3) return null;
  const rets = [];
  for (let i = 1; i < d.length; i++) rets.push(d[i].equity / d[i - 1].equity - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varp = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(varp);
  return sd > 0 ? (mean / sd) * Math.sqrt(365) : null;
}

export function tradeStats(trades) {
  const closed = trades.filter((t) => Number.isFinite(t.netPnl));
  const n = closed.length;
  if (!n) {
    return { n: 0, win: null, pf: null, avgWin: null, avgLoss: null, netPnl: 0, totalCost: 0, grossProfit: 0, costShare: null };
  }
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let totalCost = 0;
  let netPnl = 0;
  let sumWinRet = 0;
  let sumLossRet = 0;
  for (const t of closed) {
    netPnl += t.netPnl;
    totalCost += (t.feeBuy || 0) + (t.feeSell || 0) + (t.spreadCost || 0) + (t.slipCost || 0);
    if (t.netPnl > 0) {
      wins++;
      grossWin += t.netPnl;
      sumWinRet += t.ret || 0;
    } else {
      grossLoss += -t.netPnl;
      sumLossRet += t.ret || 0;
    }
  }
  const grossProfit = grossWin + totalCost;
  return {
    n,
    win: wins / n,
    pf: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin: wins ? sumWinRet / wins : null,
    avgLoss: n - wins ? sumLossRet / (n - wins) : null,
    netPnl,
    totalCost,
    grossProfit,
    costShare: grossProfit > 0 ? totalCost / grossProfit : null,
  };
}

export function periodMetrics({ startEquity, points, trades, startMs, endMs }) {
  if (!points.length) return null;
  const last = points[points.length - 1].equity;
  const totalReturn = last / startEquity - 1;
  const years = Math.max((endMs - startMs) / (365.25 * 86400_000), 1e-9);
  const cagr = (last / startEquity) ** (1 / years) - 1;
  const dd = maxDrawdown(points);
  const ts = tradeStats(trades);
  return {
    startEquity,
    endEquity: last,
    totalReturn,
    cagr,
    mdd: dd.mdd,
    mddPeakTs: dd.peakTs,
    mddTroughTs: dd.troughTs,
    sharpe: sharpeDaily(points),
    ...ts,
    years,
  };
}

export function uptimeStats(calls, startMs, endMs, tfMs = TF_MS) {
  const lastClosed = Math.floor((Date.now() - tfMs) / tfMs) * tfMs;
  const end = Math.min(endMs, lastClosed);
  const expected = Math.max(0, Math.floor((end - startMs) / tfMs));
  const onTime = new Set();
  for (const c of calls) {
    if (!c.ts) continue;
    const ts = +new Date(c.ts);
    for (const t of c.processedCandles || []) {
      if (t * 1000 + tfMs >= ts) onTime.add(t);
    }
  }
  const executed = onTime.size;
  return {
    expected,
    executed,
    uptime: expected > 0 ? Math.min(1, executed / expected) : null,
    calls: calls.length,
    errors: calls.reduce((a, c) => a + (c.errors?.length || 0), 0),
    killSwitchUses: calls.filter((c) => c.killSwitch).length,
  };
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
