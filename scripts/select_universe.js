import fs from 'node:fs';
import path from 'node:path';
import { getPairs, getPriceIncrements, getHistory, getServerTime } from '../lib/indodax.js';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const START = Math.floor(Date.parse('2023-11-06T00:00:00Z') / 1000);
const END = START + 30 * 86400;
const STABLE = new Set(['usdt', 'usdc', 'fdusd', 'usdd', 'dai', 'tusd', 'usdp', 'xaut', 'paxg']);
const FORCE = process.argv.includes('--force');

function writeUniverse(top, meta) {
  const body = top
    .map((x) => `  { pair: '${x.pair}', symbol: '${x.symbol}', id: '${x.id}', tick: ${x.tick}, qtyStep: ${x.qtyStep} },`)
    .join('\n');
  const src = `// Universe beku. Ditulis oleh scripts/select_universe.js.
// Kriteria: semua pair IDR yang terdaftar di API publik pada ${meta.selectedAt},
// diperingkat memakai turnover rupiah pada 30 hari PERTAMA periode backtest
// (2023-11-06 s/d 2023-12-06), bukan volume hari ini.
// Pair tanpa data pada awal periode dikeluarkan. Pair yang sudah delisting
// tidak tersedia di API publik -> keterbatasan data yang dicatat di README.
export const UNIVERSE = [
${body}
];

export const UNIVERSE_META = ${JSON.stringify(meta, null, 2)};
`;
  fs.writeFileSync(path.join(ROOT, 'lib', 'universe.js'), src);
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const cacheFile = path.join(DATA, 'universe_candidates.json');
  let cache = null;
  if (!FORCE && fs.existsSync(cacheFile)) cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

  const serverTime = await getServerTime();
  const pairs = await getPairs();
  const inc = await getPriceIncrements();

  const candidates = pairs
    .filter((p) => p.base_currency === 'idr')
    .filter((p) => p.coingecko_id)
    .filter((p) => !STABLE.has(p.traded_currency))
    .filter((p) => !p.is_maintenance && !p.is_market_suspended)
    .map((p) => ({
      pair: p.id.replace(/([a-z0-9]+)(idr)$/, '$1_idr'),
      id: p.id,
      symbol: p.symbol,
      base: p.traded_currency,
      tick: +(inc[p.id] || p.price_precision || 1),
      qtyStep: +p.quantity_increment || 1e-8,
      minOrder: +p.trade_min_base_currency || 10000,
    }));

  const results = cache?.results ? cache.results : [];
  const done = new Set(results.map((x) => x.pair));
  let i = 0;
  for (const c of candidates) {
    i++;
    if (done.has(c.pair)) continue;
    try {
      const bars = await getHistory(c.symbol, '240', START, END);
      const valid = bars.filter((b) => b.Time >= START && b.Time < END && b.Close > 0);
      if (valid.length >= 150) {
        const turnover = valid.reduce((a, b) => a + b.Close * b.Volume, 0);
        results.push({ ...c, bars: valid.length, first: valid[0].Time, last: valid[valid.length - 1].Time, turnover });
      }
    } catch (e) {
      console.error('lewat', c.symbol, e.message);
    }
    if (i % 25 === 0) {
      console.log(`cek ${i}/${candidates.length} · lolos ${results.length}`);
      fs.writeFileSync(cacheFile, JSON.stringify({ selectedAt: new Date().toISOString(), results }, null, 1));
    }
  }
  fs.writeFileSync(cacheFile, JSON.stringify({ selectedAt: new Date().toISOString(), results }, null, 1));

  results.sort((a, b) => b.turnover - a.turnover);
  const top = results.slice(0, 5);
  const meta = {
    selectedAt: new Date(serverTime).toISOString(),
    method: 'Semua pair IDR ber-coingecko_id yang terdaftar di API publik; diperingkat dari turnover (close x volume) 30 hari pertama backtest 2023-11-06 s/d 2023-12-06. Bukan volume hari ini.',
    periodStart: '2023-11-06T00:00:00Z',
    candidatesWithData: results.length,
    candidatesChecked: candidates.length,
    note: 'API publik hanya memuat pair yang masih ada hari ini. Pair yang delisting sebelum freeze tidak bisa dipilih; ini keterbatasan data, bukan aturan.',
  };
  writeUniverse(top, meta);

  console.log('\n=== 10 besar turnover awal periode ===');
  for (const x of results.slice(0, 10)) {
    console.log(`${x.symbol.padEnd(12)} Rp${(x.turnover / 1e9).toFixed(1)} M`.padEnd(34), `bars=${x.bars}`);
  }
  console.log('\nUniverse beku:', top.map((x) => x.symbol).join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
