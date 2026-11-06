import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CFG } from '../lib/config.js';
import { UNIVERSE, UNIVERSE_META } from '../lib/universe.js';
import { loadData, runBacktest, summarizeRun, TF_MS } from '../lib/backtest.js';

const ROOT = process.cwd();

function roundMetrics(m) {
  if (!m) return null;
  const o = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number' && Number.isFinite(v)) o[k] = +v.toFixed(6);
    else if (Array.isArray(v)) continue;
    else o[k] = v;
  }
  return o;
}

function freezeTime(root) {
  const f = path.join(root, 'data', 'freeze.json');
  if (fs.existsSync(f)) return +new Date(JSON.parse(fs.readFileSync(f, 'utf8')).freezeAt);
  return Date.now();
}

export function buildBacktestResult(root = ROOT) {
  const data = loadData(root, CFG);
  const allTimes = data.timeline;
  const freezeMs = freezeTime(root);
  const endMs = Math.min(freezeMs, allTimes[allTimes.length - 1] + TF_MS);
  const startMs = Date.parse('2023-11-06T00:00:00Z');
  const splitMs = Date.parse('2025-11-06T00:00:00Z');
  const windowStart = freezeMs - 10 * 86400_000;

  console.log('backtest penuh', new Date(startMs).toISOString(), '->', new Date(endMs).toISOString());
  const fullRun = runBacktest(data, { startMs, endMs, cfg: CFG, entryMode: CFG.entryMode });
  const full = summarizeRun(fullRun, { startMs, endMs, cfg: CFG, data });
  console.log('  CAGR', (full.cagr * 100).toFixed(2), '% · MDD', (full.mdd * 100).toFixed(2), '% · trade', full.n);

  const isRun = runBacktest(data, { startMs, endMs: splitMs, cfg: CFG, entryMode: CFG.entryMode });
  const is = summarizeRun(isRun, { startMs, endMs: splitMs, cfg: CFG, data });

  const oosRun = runBacktest(data, { startMs: splitMs, endMs, cfg: CFG, entryMode: CFG.entryMode });
  const oos = summarizeRun(oosRun, { startMs: splitMs, endMs, cfg: CFG, data });

  const winRun = runBacktest(data, { startMs: windowStart, endMs, cfg: CFG, entryMode: CFG.entryMode });
  const window10 = summarizeRun(winRun, { startMs: windowStart, endMs, cfg: CFG, data });

  const brkRun = runBacktest(data, { startMs, endMs, cfg: CFG, entryMode: 'break' });
  const brk = summarizeRun(brkRun, { startMs, endMs, cfg: CFG, data });

  const meta = {
    generatedAt: new Date().toISOString(),
    freezeAt: new Date(freezeMs).toISOString(),
    timeframe: '240',
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    split: new Date(splitMs).toISOString(),
    window10: { start: new Date(windowStart).toISOString(), end: new Date(endMs).toISOString(), days: 10 },
    capital: CFG.startEquity,
    feeBuy: CFG.feeBuy,
    feeSell: CFG.feeSell,
    feeSource: {
      api: 'https://indodax.com/api/pairs trade_fee_percent_taker = 0.2%',
      official: 'https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX',
      officialAccess: '2026-11-06',
      rule: 'IDR PRO all-in taker: beli 0.20555%, jual 0.41555%; dipakai angka tertinggi.',
    },
    spreadSource: data.depth.generatedAt
      ? { type: 'snapshot_order_book', generatedAt: data.depth.generatedAt, notional: 25_000_000 }
      : { type: 'fallback', spreadBps: 10, slipBps: 5 },
    universeMeta: UNIVERSE_META,
    engine: 'lib/backtest.js + lib/strategy.js (fungsi sinyal sama dengan bot)',
  };

  const universe = UNIVERSE.map((u) => {
    const d = data.depth.pairs?.[u.pair] || {};
    return {
      pair: u.pair,
      symbol: u.symbol,
      tick: u.tick,
      qtyStep: u.qtyStep,
      spreadBps: d.spreadBps ?? null,
      buySlipBps: d.buySlipBps?.[25_000_000] ?? null,
      sellSlipBps: d.sellSlipBps?.[25_000_000] ?? null,
    };
  });

  const slim = (s) => ({
    metrics: roundMetrics(s),
    trades: s.trades.map((t) => ({
      ...t,
      entryTs: new Date(t.entryTs).toISOString(),
      exitTs: new Date(t.exitTs).toISOString(),
      ret: +t.ret.toFixed(6),
      netPnl: +t.netPnl.toFixed(2),
      entryPrice: +t.entryPrice.toFixed(2),
      exitPrice: +t.exitPrice.toFixed(2),
      feeBuy: +t.feeBuy.toFixed(2),
      feeSell: +t.feeSell.toFixed(2),
      spreadCost: +t.spreadCost.toFixed(2),
      slipCost: +t.slipCost.toFixed(2),
    })),
  });

  const result = {
    meta,
    universe,
    full: {
      metrics: roundMetrics(full),
      equity: full.equity.map((p) => [p.ts, Math.round(p.equity)]),
      trades: slim(full).trades,
      benchmark: full.benchmark,
      benchmarkPoints: full.benchmarkPoints.map((p) => [p.ts, Math.round(p.equity)]),
      openPositions: full.openPositions.map((p) => ({ pair: p.pair, qty: p.qty, entryPrice: p.entryPrice })),
    },
    is: { metrics: roundMetrics(is) },
    oos: { metrics: roundMetrics(oos), trades: slim(oos).trades },
    window10: {
      metrics: roundMetrics(window10),
      equity: window10.equity.map((p) => [p.ts, Math.round(p.equity)]),
      trades: slim(window10).trades,
      openPositions: window10.openPositions.map((p) => ({ pair: p.pair, qty: p.qty, entryPrice: p.entryPrice })),
    },
    variants: {
      limit: roundMetrics(full),
      breakout: roundMetrics(brk),
      window10_limit: roundMetrics(window10),
      window10_breakout: roundMetrics(summarizeRun(
        runBacktest(data, { startMs: windowStart, endMs, cfg: CFG, entryMode: 'break' }),
        { startMs: windowStart, endMs, cfg: CFG, data },
      )),
    },
  };

  return result;
}

function writeCsv(file, rows, header) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

export function writeBacktestArtifacts(root = ROOT) {
  const out = path.join(root, 'data', 'backtest');
  fs.mkdirSync(out, { recursive: true });
  const result = buildBacktestResult(root);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  writeCsv(
    path.join(out, 'trades.csv'),
    result.full.trades.map((t) => [t.pair, t.entryTs, t.exitTs, t.entryPrice, t.exitPrice, t.qty, t.ret, t.netPnl, t.reason, t.holdBars]),
    ['pair', 'entry_ts', 'exit_ts', 'entry_price', 'exit_price', 'qty', 'ret', 'net_pnl', 'reason', 'hold_bars'],
  );
  writeCsv(
    path.join(out, 'equity.csv'),
    result.full.equity.map(([ts, eq]) => [new Date(ts).toISOString(), eq]),
    ['ts', 'equity'],
  );
  return result;
}

function main() {
  const result = writeBacktestArtifacts(ROOT);
  const m = result.full.metrics;
  console.log('\n=== RINGKASAN BACKTEST 3 TAHUN ===');
  console.log(`Total return ${(m.totalReturn * 100).toFixed(2)}% · CAGR ${(m.cagr * 100).toFixed(2)}% · MDD ${(m.mdd * 100).toFixed(2)}%`);
  console.log(`PF ${m.pf?.toFixed(2)} · win ${(m.win * 100).toFixed(1)}% · trade ${m.n} · biaya/laba kotor ${(m.costShare * 100).toFixed(1)}%`);
  console.log(`IS CAGR ${(result.is.metrics.cagr * 100).toFixed(2)}% · OOS CAGR ${(result.oos.metrics.cagr * 100).toFixed(2)}%`);
  console.log(`10 hari terakhir: return ${(result.window10.metrics.totalReturn * 100).toFixed(2)}% · trade ${result.window10.metrics.n}`);
  console.log('ditulis', path.join(ROOT, 'data', 'backtest', 'result.json'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
