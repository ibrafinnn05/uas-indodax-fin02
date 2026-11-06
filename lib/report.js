import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { UNIVERSE, UNIVERSE_META } from './universe.js';
import { TF_MS, wibDateKey } from './time.js';
import { maxDrawdown, sharpeDaily } from './metrics.js';
import { loadData, runBacktest, summarizeRun } from './backtest.js';

export const LOG_KEYS = {
  calls: 'finn:calls',
  orders: 'finn:orders',
  signals: 'finn:signals',
  equity: 'finn:equity',
  errors: 'finn:errors',
  depth: 'finn:depth',
  spreads: 'finn:spreads',
};

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readJsonl(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').trim();
    if (!txt) return [];
    return txt
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sumber log: file mentah (offline) atau store (Vercel).
// ---------------------------------------------------------------------------

export function logsFromFiles(root = process.cwd()) {
  const dir = path.join(root, 'logs', 'raw');
  const manifest = readJson(path.join(dir, 'manifest.json'), null);
  return {
    source: 'logs/raw (file mentah)',
    calls: readJsonl(path.join(dir, 'calls.jsonl')),
    orders: readJsonl(path.join(dir, 'orders.jsonl')),
    signals: readJsonl(path.join(dir, 'signals.jsonl')),
    equity: readJsonl(path.join(dir, 'equity.jsonl')),
    errors: readJsonl(path.join(dir, 'errors.jsonl')),
    spreads: readJsonl(path.join(dir, 'spreads.jsonl')),
    depth: [],
    depthCount: manifest?.counts?.depth ?? 0,
    state: readJson(path.join(dir, 'state.json'), null),
    manifest,
  };
}

export async function logsFromStore(store) {
  const [calls, orders, signals, equity, errors, spreads] = await Promise.all([
    store.list(LOG_KEYS.calls),
    store.list(LOG_KEYS.orders),
    store.list(LOG_KEYS.signals),
    store.list(LOG_KEYS.equity),
    store.list(LOG_KEYS.errors),
    store.list(LOG_KEYS.spreads),
  ]);
  const state = await store.getState();
  let depthCount = 0;
  if (typeof store.len === 'function') {
    try {
      depthCount = await store.len(LOG_KEYS.depth);
    } catch {
      depthCount = 0;
    }
  }
  return {
    source: 'store ' + (store.mode || 'unknown'),
    calls,
    orders,
    signals,
    equity,
    errors,
    spreads,
    depth: [],
    depthCount,
    state,
  };
}

// ---------------------------------------------------------------------------
// Statistik forward, dihitung hanya dari log mentah.
// ---------------------------------------------------------------------------

function finite(x) {
  return Number.isFinite(+x);
}

export function forwardTradeStats(orders) {
  const sells = (orders || []).filter((o) => o.side === 'sell' && finite(o.netPnl));
  const n = sells.length;
  if (!n) {
    return {
      n: 0, win: null, pf: null, avgWin: null, avgLoss: null,
      netPnl: 0, totalCost: 0, grossProfit: 0, costShare: null,
      wins: 0, losses: 0,
    };
  }
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let netPnl = 0;
  let totalCost = 0;
  let sumWinRet = 0;
  let sumLossRet = 0;
  for (const t of sells) {
    const pnl = +t.netPnl;
    netPnl += pnl;
    const cost =
      (+t.entryFee || 0) +
      (+t.fee || 0) +
      (+t.entrySpreadCost || 0) +
      (+t.entrySlipCost || 0) +
      (+t.spreadCost || 0) +
      (+t.slipCost || 0);
    totalCost += cost;
    if (pnl > 0) {
      wins++;
      grossWin += pnl;
      sumWinRet += +t.ret || 0;
    } else {
      grossLoss += -pnl;
      sumLossRet += +t.ret || 0;
    }
  }
  const grossProfit = grossWin + totalCost;
  return {
    n,
    wins,
    losses: n - wins,
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

export function forwardEquityPoints(logs, startedAt, nowMs) {
  const pts = [];
  for (const r of logs.equity || []) {
    const ts = +new Date(r.ts);
    if (Number.isFinite(ts) && finite(r.equity)) pts.push({ ts, equity: +r.equity });
  }
  const state = logs.state;
  if (state && finite(state.equity)) {
    const ts = state.lastTick?.ts ? +new Date(state.lastTick.ts) : nowMs;
    pts.push({ ts, equity: +state.equity });
  }
  if (!pts.length) return [];
  pts.sort((a, b) => a.ts - b.ts);
  const first = pts[0];
  if (startedAt && first.ts > startedAt) pts.unshift({ ts: startedAt, equity: CFG.startEquity });
  return pts;
}

// Uptime resmi: candle dihitung terlaksana bila diproses sebelum candle
// berikutnya ditutup (t + 2 x TF).
export function uptimeFromCalls(calls, startMs, endMs, tfMs = TF_MS) {
  const lastClosed = Math.floor(endMs / tfMs) * tfMs;
  const expected = Math.max(0, Math.floor((lastClosed - startMs) / tfMs));
  const executed = new Set();
  let errors = 0;
  let killSwitchUses = 0;
  let lateCalls = 0;
  for (const c of calls || []) {
    const ts = +new Date(c.ts);
    if (!Number.isFinite(ts)) continue;
    errors += Array.isArray(c.errors) ? c.errors.length : 0;
    if (c.killSwitch) killSwitchUses++;
    if (c.latencyMs > tfMs) lateCalls++;
    for (const t of c.processedCandles || []) {
      // t adalah detik pembukaan candle. Batas terlambat: candle berikutnya
      // ditutup pada t*1000 + 2*tfMs.
      if (ts < +t * 1000 + 2 * tfMs) executed.add(+t);
    }
  }
  return {
    expected,
    executed: executed.size,
    uptime: expected > 0 ? Math.min(1, executed.size / expected) : null,
    calls: (calls || []).length,
    errors,
    killSwitchUses,
    lateCalls,
    processedSet: executed,
  };
}

export function median(xs) {
  const a = (xs || []).filter(finite).map(Number).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function spreadComparison(depthSummary, spreads, universe = UNIVERSE) {
  return universe.map((u) => {
    const bt = depthSummary?.pairs?.[u.pair];
    const fw = (spreads || []).filter((s) => s.pair === u.pair).map((s) => s.spreadBps);
    return {
      pair: u.pair,
      symbol: u.symbol,
      backtestBps: bt?.spreadBps ?? null,
      forwardBps: median(fw),
      forwardN: fw.length,
      buySlipBps: bt?.buySlipBps?.[25_000_000] ?? null,
      sellSlipBps: bt?.sellSlipBps?.[25_000_000] ?? null,
    };
  });
}

export function costDetailFromTrades(trades) {
  const t = trades || [];
  const feeBuy = t.reduce((a, x) => a + (+x.feeBuy || 0), 0);
  const feeSell = t.reduce((a, x) => a + (+x.feeSell || 0), 0);
  const spread = t.reduce((a, x) => a + (+x.spreadCost || 0), 0);
  const slip = t.reduce((a, x) => a + (+x.slipCost || 0), 0);
  const notional = t.reduce((a, x) => a + (+x.entryNotional || 0) + (+x.exitNotional || 0), 0);
  const total = feeBuy + feeSell + spread + slip;
  return {
    feeBuy, feeSell, spread, slip, total, notional,
    totalBps: notional > 0 ? (total / notional) * 10000 : null,
    perTrade: t.length ? total / t.length : null,
  };
}

export function costDetailFromOrders(orders) {
  const o = orders || [];
  const feeBuy = o.filter((x) => x.side === 'buy').reduce((a, x) => a + (+x.fee || 0), 0);
  const feeSell = o.filter((x) => x.side === 'sell').reduce((a, x) => a + (+x.fee || 0), 0);
  const spread = o.reduce((a, x) => a + (+x.spreadCost || 0), 0);
  const slip = o.reduce((a, x) => a + (+x.slipCost || 0), 0);
  const notional = o.reduce((a, x) => a + (+x.notional || 0), 0);
  const total = feeBuy + feeSell + spread + slip;
  return {
    feeBuy, feeSell, spread, slip, total, notional,
    totalBps: notional > 0 ? (total / notional) * 10000 : null,
    perTrade: o.length ? total / o.length : null,
  };
}

// ---------------------------------------------------------------------------
// Backtest pada jendela yang benar-benar diproses bot.
// ---------------------------------------------------------------------------

export function forwardWindowBacktest(root, logs, cfg = CFG) {
  const processed = [...new Set((logs.calls || []).flatMap((c) => c.processedCandles || []))]
    .filter((t) => Number.isFinite(+t))
    .sort((a, b) => a - b);
  if (!processed.length) return null;
  const startSec = processed[0];
  const endSec = processed[processed.length - 1];
  const startMs = startSec * 1000;
  const endMs = (endSec + 1) * 1000 - 1;
  if (!(endMs > startMs)) return null;

  const data = loadData(root, cfg);
  const run = runBacktest(data, { startMs, endMs, cfg, entryMode: cfg.entryMode });
  const summary = summarizeRun(run, { startMs, endMs, cfg, data });
  const signals = (run.signals || [])
    .filter((s) => s.action === 'signal')
    .map((s) => ({ candle: s.candle ?? Math.round(+new Date(s.ts) / 1000) - 240, pair: s.pair, mode: s.mode, limit: s.limit }));

  const fwSignals = (logs.signals || [])
    .filter((s) => s.action === 'signal' && finite(s.candle))
    .filter((s) => +s.candle >= startSec && +s.candle <= endSec)
    .map((s) => ({ candle: +s.candle, pair: s.pair, mode: s.mode, limit: s.limit }));

  const expected = new Set(signals.map((s) => `${s.candle}|${s.pair}`));
  const actual = new Set(fwSignals.map((s) => `${s.candle}|${s.pair}`));
  const matched = [...actual].filter((k) => expected.has(k));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
    metrics: summary,
    trades: summary.trades,
    signals,
    compare: {
      expected: expected.size,
      actual: actual.size,
      matched: matched.length,
      matchRate: expected.size + actual.size === 0 ? null : expected.size > 0 ? matched.length / expected.size : 0,
      missing,
      extra,
    },
  };
}

// ---------------------------------------------------------------------------
// Model lengkap untuk dashboard.
// ---------------------------------------------------------------------------

export function configSnapshot(cfg = CFG) {
  return {
    timeframe: cfg.timeframe,
    hhvN: cfg.hhvN,
    maN: cfg.maN,
    atrN: cfg.atrN,
    turnoverN: cfg.turnoverN,
    entryMode: cfg.entryMode,
    limitAtr: cfg.limitAtr,
    ttlBars: cfg.ttlBars,
    runaway: cfg.runaway,
    strongAtr: cfg.strongAtr,
    stopAtr: cfg.stopAtr,
    maxHoldBars: cfg.maxHoldBars,
    startEquity: cfg.startEquity,
    riskPerTrade: cfg.riskPerTrade,
    maxPositions: cfg.maxPositions,
    maxPerName: cfg.maxPerName,
    cooldownBars: cfg.cooldownBars,
    minOrderIdr: cfg.minOrderIdr,
    dailyLossLimit: cfg.dailyLossLimit,
    feeBuy: cfg.feeBuy,
    feeSell: cfg.feeSell,
    minTurnover20: cfg.minTurnover20,
    maxSpreadBps: cfg.maxSpreadBps,
    minBars: cfg.minBars,
  };
}

function roundMetrics(m) {
  if (!m) return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = +v.toFixed(6);
    else if (v === null || typeof v === 'string') out[k] = v;
  }
  return out;
}

export function buildModel({
  root = process.cwd(),
  logs,
  backtest,
  freeze,
  depthSummary,
  nowMs = Date.now(),
  includeWindowBacktest = false,
} = {}) {
  const bt = backtest || readJson(path.join(root, 'data', 'backtest', 'result.json'), null);
  const fz = freeze || readJson(path.join(root, 'data', 'freeze.json'), {});
  const depth = depthSummary || readJson(path.join(root, 'data', 'depth', 'summary.json'), { pairs: {} });
  const l = logs || { calls: [], orders: [], signals: [], equity: [], errors: [], spreads: [], state: null };

  const freezeMs = fz.freezeAt ? Date.parse(fz.freezeAt) : null;
  const startedAt =
    (l.state?.startedAt && Date.parse(l.state.startedAt)) ||
    (l.calls?.[0]?.ts && Date.parse(l.calls[0].ts)) ||
    null;

  const eqPoints = forwardEquityPoints(l, startedAt, nowMs);
  const startEquity = CFG.startEquity;
  const lastEq = eqPoints.length ? eqPoints[eqPoints.length - 1].equity : startEquity;
  const fwTrades = forwardTradeStats(l.orders);
  const fwMdd = eqPoints.length > 1 ? maxDrawdown(eqPoints).mdd : 0;

  const daysElapsed = startedAt ? Math.max(0, (nowMs - startedAt) / 86400_000) : 0;
  const processed = [...new Set((l.calls || []).flatMap((c) => c.processedCandles || []))].filter(finite);
  const status = !startedAt
    ? 'pending'
    : daysElapsed >= 10
      ? 'complete'
      : processed.length
        ? 'running'
        : 'menunggu_candle';

  const fwOps = uptimeFromCalls(l.calls, processed.length ? Math.min(...processed) * 1000 : startedAt || nowMs, nowMs);
  const fwSpread = spreadComparison(depth, l.spreads, UNIVERSE);

  let window = null;
  if (includeWindowBacktest) {
    try {
      window = forwardWindowBacktest(root, l, CFG);
    } catch (e) {
      window = { error: e.message };
    }
  }

  const fwMetrics = {
    startEquity,
    endEquity: lastEq,
    totalReturn: lastEq / startEquity - 1,
    mdd: fwMdd,
    sharpe: eqPoints.length > 2 ? sharpeDaily(eqPoints) : null,
    ...fwTrades,
    points: eqPoints.length,
  };

  let gap = null;
  if (window && window.metrics) {
    gap = {
      totalReturn: fwMetrics.totalReturn - window.metrics.totalReturn,
      mdd: fwMetrics.mdd - window.metrics.mdd,
      pf: fwMetrics.pf != null && window.metrics.pf != null ? fwMetrics.pf - window.metrics.pf : null,
      win: fwMetrics.win != null && window.metrics.win != null ? fwMetrics.win - window.metrics.win : null,
      trades: fwMetrics.n - window.metrics.n,
      partial: status !== 'complete',
      days: daysElapsed,
      benchmark: window.metrics.benchmark || null,
    };
  }

  const state = l.state || null;
  const day = state?.day || null;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    freeze: {
      freezeAt: fz.freezeAt || null,
      dataCutoff: fz.dataCutoff || null,
      note: fz.note || null,
      late: freezeMs ? freezeMs > Date.parse('2026-11-04T05:00:00Z') : null,
    },
    config: configSnapshot(CFG),
    universe: UNIVERSE.map((u) => ({
      ...u,
      ...(bt?.universe?.find((x) => x.pair === u.pair) || {}),
    })),
    universeMeta: UNIVERSE_META,
    backtest: bt
      ? {
          meta: bt.meta,
          full: bt.full,
          is: bt.is,
          oos: bt.oos,
          window10: bt.window10,
          variants: bt.variants,
          universe: bt.universe,
        }
      : null,
    forward: {
      status,
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      now: new Date(nowMs).toISOString(),
      daysElapsed,
      daysTarget: 10,
      source: l.source || 'unknown',
      metrics: roundMetrics(fwMetrics),
      raw: {
        calls: (l.calls || []).length,
        orders: (l.orders || []).length,
        signals: (l.signals || []).length,
        equity: (l.equity || []).length,
        errors: (l.errors || []).length,
        spreads: (l.spreads || []).length,
        depthSnapshots: l.depthCount ?? (l.depth || []).length,
        processedCandles: processed.length,
      },
      ops: roundMetrics(fwOps),
      state: state
        ? {
            cash: state.cash,
            equity: state.equity,
            positions: Object.keys(state.positions || {}),
            pending: Object.entries(state.pending || {}).map(([pair, o]) => ({ pair, ...o })),
            day,
            killSwitch: state.killSwitch,
            lastTick: state.lastTick,
            stats: state.stats,
            startedAt: state.startedAt,
          }
        : null,
      orders: (l.orders || []).slice(-80),
      signals: (l.signals || []).slice(-120),
      equityPoints: eqPoints,
      errors: (l.errors || []).slice(-20),
      spread: fwSpread,
      window,
      gap,
    },
    costs: {
      backtest: costDetailFromTrades(bt?.full?.trades || []),
      backtestWindow: window?.metrics?.trades ? costDetailFromTrades(window.metrics.trades) : null,
      forward: costDetailFromOrders(l.orders || []),
    },
    depthMeta: depth,
    reconciliation: {
      logsSource: l.source || 'unknown',
      manifest: l.manifest || null,
      note: 'Semua angka forward dihitung dari log mentah (calls/orders/equity/signals). Backtest dihitung ulang dari candle CSV di data/raw.',
    },
  };
}

export function modelSummary(model) {
  return {
    generatedAt: model.generatedAt,
    freezeAt: model.freeze.freezeAt,
    forwardStatus: model.forward.status,
    forwardDays: model.forward.daysElapsed,
    backtest: model.backtest?.full?.metrics || null,
    forward: model.forward.metrics,
    gap: model.forward.gap,
    raw: model.forward.raw,
    match: model.forward.window?.compare || null,
  };
}
