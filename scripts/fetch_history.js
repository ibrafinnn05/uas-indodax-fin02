import fs from 'node:fs';
import path from 'node:path';
import { UNIVERSE, UNIVERSE_META } from '../lib/universe.js';
import { getHistoryPaged, getServerTime } from '../lib/indodax.js';

const ROOT = process.cwd();
const RAW = path.join(ROOT, 'data', 'raw');
const START = Math.floor(Date.parse('2023-11-06T00:00:00Z') / 1000);
const TF = '240';
const TF_SEC = 240 * 60;

function csv(bars) {
  const lines = ['time,open,high,low,close,volume'];
  for (const b of bars) lines.push(`${b.Time},${b.Open},${b.High},${b.Low},${b.Close},${b.Volume}`);
  return lines.join('\n') + '\n';
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const serverTime = await getServerTime();
  const nowSec = Math.floor(serverTime / 1000);
  const manifest = {
    fetchedAt: new Date().toISOString(),
    serverTime: new Date(serverTime).toISOString(),
    timeframe: TF,
    start: new Date(START * 1000).toISOString(),
    end: new Date(nowSec * 1000).toISOString(),
    universeMeta: UNIVERSE_META,
    pairs: [],
  };

  for (const u of UNIVERSE) {
    console.log('tarik', u.symbol, '...');
    const { bars, pages } = await getHistoryPaged(u.symbol, TF, START, nowSec);
    const closed = bars.filter((b) => b.Time + TF_SEC <= nowSec);
    const gaps = [];
    for (let i = 1; i < closed.length; i++) {
      const d = closed[i].Time - closed[i - 1].Time;
      if (d !== TF_SEC) gaps.push({ at: new Date(closed[i].Time * 1000).toISOString(), delta: d });
    }
    if (closed.length < 5000) throw new Error(`${u.symbol}: hanya ${closed.length} bar, backtest 3 tahun butuh ~6570`);
    fs.writeFileSync(path.join(RAW, `${u.pair}_240.csv`), csv(closed));
    fs.writeFileSync(path.join(RAW, `${u.pair}_raw.json`), JSON.stringify({ symbol: u.symbol, pages, bars: closed }));
    const rec = {
      pair: u.pair,
      symbol: u.symbol,
      pages,
      bars: closed.length,
      first: new Date(closed[0].Time * 1000).toISOString(),
      last: new Date(closed[closed.length - 1].Time * 1000).toISOString(),
      gaps: gaps.length,
      gapSamples: gaps.slice(0, 5),
    };
    manifest.pairs.push(rec);
    console.log(`  ${closed.length} bar · ${rec.first} s/d ${rec.last} · celah ${gaps.length}`);
  }

  fs.writeFileSync(path.join(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest ditulis');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
