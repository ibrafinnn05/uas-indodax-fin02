import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getStore } from '../lib/store.js';
import { LOG_KEYS } from '../lib/report.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'logs', 'raw');

function jsonl(rows) {
  return (rows || []).map((r) => JSON.stringify(r)).join('\n') + ((rows || []).length ? '\n' : '');
}

function csvValue(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(rows, header) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(csvValue).join(','));
  return lines.join('\n') + '\n';
}

export async function exportLogs(root = ROOT) {
  const dir = path.join(root, 'logs', 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const store = getStore();

  const [calls, orders, signals, equity, errors, depth, spreads] = await Promise.all([
    store.list(LOG_KEYS.calls),
    store.list(LOG_KEYS.orders),
    store.list(LOG_KEYS.signals),
    store.list(LOG_KEYS.equity),
    store.list(LOG_KEYS.errors),
    store.list(LOG_KEYS.depth),
    store.list(LOG_KEYS.spreads),
  ]);
  const state = await store.getState();
  let candles = null;
  if (typeof store.getValue === 'function') {
    const txt = await store.getValue(LOG_KEYS.candles);
    if (txt) {
      try {
        candles = JSON.parse(txt);
      } catch {
        candles = null;
      }
    }
  }

  const files = {
    'calls.jsonl': jsonl(calls),
    'orders.jsonl': jsonl(orders),
    'signals.jsonl': jsonl(signals),
    'equity.jsonl': jsonl(equity),
    'errors.jsonl': jsonl(errors),
    'depth.jsonl': jsonl(depth),
    'spreads.jsonl': jsonl(spreads),
    'candles.json': JSON.stringify(candles, null, 1),
    'state.json': JSON.stringify(state, null, 1),
  };
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }

  fs.writeFileSync(
    path.join(dir, 'orders.csv'),
    csv(
      orders.map((o) => [
        o.ts, o.pair, o.side, o.reason, o.qty, o.price, o.notional, o.fee,
        o.bestBid, o.bestAsk, o.signalPrice, o.slippageBps,
        o.spreadCost, o.slipCost, o.netPnl, o.ret,
      ]),
      ['ts', 'pair', 'side', 'reason', 'qty', 'price', 'notional', 'fee', 'best_bid', 'best_ask', 'signal_price', 'slippage_bps', 'spread_cost', 'slip_cost', 'net_pnl', 'ret'],
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'equity.csv'),
    csv(equity.map((e) => [e.date, e.ts, e.equity, e.cash, e.positions]), ['date', 'ts', 'equity', 'cash', 'positions']),
  );

  const manifest = {
    exportedAt: new Date().toISOString(),
    storeMode: store.mode,
    counts: {
      calls: calls.length,
      orders: orders.length,
      signals: signals.length,
      equity: equity.length,
      errors: errors.length,
      depth: depth.length,
      spreads: spreads.length,
      candlesPairs: candles ? Object.keys(candles.pairs || {}).length : 0,
      candlesBars: candles ? Object.values(candles.pairs || {}).reduce((a, b) => a + (b?.length || 0), 0) : 0,
    },
    stateStartedAt: state?.startedAt || null,
    lastTick: state?.lastTick || null,
    note: 'File ini adalah ekspor mentah dari store. Dashboard dan hitung_ulang hanya membaca file ini (dan data/raw), bukan angka yang ditulis tangan.',
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('Log diekspor ke', dir);
  console.log(manifest.counts);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportLogs().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
