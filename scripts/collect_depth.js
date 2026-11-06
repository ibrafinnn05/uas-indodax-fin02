import fs from 'node:fs';
import path from 'node:path';
import { UNIVERSE } from '../lib/universe.js';
import { getDepth, getServerTime } from '../lib/indodax.js';
import { bestBid, bestAsk, spreadBps, walkBuy, walkSell } from '../lib/broker.js';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'data', 'depth');
const RAW = path.join(DIR, 'raw');
const NOTIONALS = [10_000_000, 25_000_000, 50_000_000, 100_000_000];

const arg = (name, d) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? +process.argv[i + 1] : d;
};
const ROUNDS = arg('rounds', 3);
const INTERVAL = arg('interval', 20);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshotStats(depth) {
  const bid = bestBid(depth);
  const ask = bestAsk(depth);
  const mid = bid && ask ? (bid + ask) / 2 : null;
  const out = { bid, ask, mid, spreadBps: spreadBps(depth), buy: {}, sell: {} };
  for (const n of NOTIONALS) {
    const b = walkBuy(depth, n);
    out.buy[n] = b.partial ? null : ((b.vwap - ask) / ask) * 10000;
    const qty = n / bid;
    const s = walkSell(depth, qty);
    out.sell[n] = s.partial ? null : ((bid - s.vwap) / bid) * 10000;
  }
  return out;
}

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const rows = [];
  const serverTime = await getServerTime();
  for (let r = 1; r <= ROUNDS; r++) {
    console.log(`snapshot ronde ${r}/${ROUNDS}`);
    for (const u of UNIVERSE) {
      try {
        const depth = await getDepth(u.id);
        const ts = Date.now();
        const stat = snapshotStats(depth);
        const file = path.join(RAW, `${new Date(ts).toISOString().replace(/[:.]/g, '-')}_${u.pair}.json`);
        fs.writeFileSync(file, JSON.stringify({ ts: new Date(ts).toISOString(), pair: u.pair, depth }));
        rows.push({ ts: new Date(ts).toISOString(), pair: u.pair, file: path.relative(ROOT, file), ...stat });
        console.log(`  ${u.symbol} spread ${stat.spreadBps?.toFixed(1)} bp`);
      } catch (e) {
        console.error('  gagal', u.symbol, e.message);
      }
    }
    if (r < ROUNDS) await sleep(INTERVAL * 1000);
  }

  const lines = rows.map((x) => JSON.stringify(x)).join('\n') + '\n';
  fs.appendFileSync(path.join(DIR, 'snapshots.jsonl'), lines);

  const summary = { generatedAt: new Date().toISOString(), serverTime: new Date(serverTime).toISOString(), notionalSamples: NOTIONALS, pairs: {} };
  for (const u of UNIVERSE) {
    const rs = rows.filter((x) => x.pair === u.pair);
    summary.pairs[u.pair] = {
      n: rs.length,
      spreadBps: median(rs.map((x) => x.spreadBps)),
      buySlipBps: Object.fromEntries(NOTIONALS.map((n) => [n, median(rs.map((x) => x.buy[n]))])),
      sellSlipBps: Object.fromEntries(NOTIONALS.map((n) => [n, median(rs.map((x) => x.sell[n]))])),
    };
  }
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nRingkasan median:');
  for (const [pair, s] of Object.entries(summary.pairs)) console.log(pair, s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
