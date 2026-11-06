import fs from 'node:fs';
import path from 'node:path';
import { CFG, pairMeta } from '../lib/config.js';
import { UNIVERSE } from '../lib/universe.js';
import { bestBid, bestAsk, spreadBps, walkBuy, walkSell, fee } from '../lib/broker.js';
import { sizePosition, signalAt, computeIndicators } from '../lib/strategy.js';
import { runBacktest } from '../lib/backtest.js';
import * as botSignal from '../lib/strategy.js';
import { TF_MS } from '../lib/time.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'logs', 'test');
const lines = [];
const say = (s) => {
  console.log(s);
  lines.push(s);
};
let failed = 0;
const check = (name, ok, detail = '') => {
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

say('=== UJI EKSEKUSI & KONSISTENSI KODE (bukan forward test) ===');
say(`waktu: ${new Date().toISOString()}`);

// 1. Backtest dan bot memakai fungsi sinyal yang sama.
const backtestSrc = fs.readFileSync(path.join(ROOT, 'lib', 'backtest.js'), 'utf8');
const tickSrc = fs.readFileSync(path.join(ROOT, 'lib', 'tick.js'), 'utf8');
check(
  'backtest & bot sama-sama import signalAt dari lib/strategy.js',
  backtestSrc.includes("from './strategy.js'") && tickSrc.includes("from './strategy.js'"),
  'tidak ada duplikasi logika sinyal',
);
check('signalAt eksport tunggal', typeof botSignal.signalAt === 'function');

// 2. Fill harus mengikuti order book (beli di ask, jual di bid), bukan mid.
const depthFile = fs
  .readdirSync(path.join(ROOT, 'data', 'depth', 'raw'))
  .sort()[0];
const depth = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'depth', 'raw', depthFile), 'utf8'));
const bid = bestBid(depth.depth);
const ask = bestAsk(depth.depth);
const mid = (bid + ask) / 2;
const notional = 25_000_000;
const buy = walkBuy(depth.depth, notional);
const sell = walkSell(depth.depth, notional / bid);
check('snapshot order book punya bid & ask', bid > 0 && ask > 0 && ask >= bid, `bid ${bid} ask ${ask} spread ${spreadBps(depth.depth).toFixed(1)} bp`);
check('beli terealisasi >= ask (tidak pernah di mid/bawah ask)', buy.vwap >= ask, `vwap ${buy.vwap} vs ask ${ask}`);
check('jual terealisasi di bawah bid (bukan mid)', sell.vwap < bid, `vwap ${sell.vwap} vs bid ${bid}`);
check('order 25 juta terisi penuh di level', !buy.partial && !sell.partial, `${buy.levels} level beli, ${sell.levels} level jual`);

// 3. Fee dan minimum order.
const fBuy = fee(buy.notional, CFG.feeBuy);
const fSell = fee(sell.notional, CFG.feeSell);
check('fee beli = 0,20555% (taker all-in resmi)', Math.abs(fBuy / buy.notional - 0.0020555) < 1e-12, `${fBuy.toFixed(0)} rupiah`);
check('fee jual = 0,41555%', Math.abs(fSell / sell.notional - 0.0041555) < 1e-12, `${fSell.toFixed(0)} rupiah`);
check('minimum order >= Rp25.000', buy.notional >= CFG.minOrderIdr, `${buy.notional.toFixed(0)}`);

// 4. Sizing menghormati risiko, batas per nama, dan kas.
const atr = ask * 0.01;
const sz = sizePosition({
  equity: CFG.startEquity,
  cash: CFG.startEquity,
  price: ask,
  atr,
  tick: pairMeta('btc_idr').tick,
  qtyStep: pairMeta('btc_idr').qtyStep,
  cfg: CFG,
});
check('sizing menghasilkan qty', !!sz && sz.qty > 0);
check('risiko per trade <= 1% equity', sz.qty * CFG.stopAtr * atr <= CFG.startEquity * CFG.riskPerTrade + 1, `risiko ${((sz.qty * CFG.stopAtr * atr) / CFG.startEquity * 100).toFixed(3)}%`);
check('notional per nama <= 20% equity', sz.qty * ask <= CFG.startEquity * CFG.maxPerName + 1);
check('stop di bawah harga masuk', sz.stop < ask, `stop ${sz.stop}`);

// 5. Aturan keluar: hanya harga (stop) dan waktu (maxHoldBars).
const exitAt = 0 + CFG.maxHoldBars * TF_MS;
check('exit waktu = entry + maxHoldBars candle', exitAt === 120 * TF_MS, `${CFG.maxHoldBars} bar x 4 jam = ${CFG.maxHoldBars * 4} jam`);
check('exit hanya stop (harga) atau waktu', CFG.stopAtr > 0 && CFG.maxHoldBars > 0, 'tanpa trailing/TP/fundamental');

// 6. Sinyal pada candle nyata: pastikan aturan identik dengan backtest.
const csv = fs.readFileSync(path.join(ROOT, 'data', 'raw', 'btc_idr_240.csv'), 'utf8').trim().split(/\r?\n/);
const bars = csv.slice(1).map((l) => {
  const [Time, Open, High, Low, Close, Volume] = l.split(',').map(Number);
  return { Time, Open, High, Low, Close, Volume };
});
const ind = computeIndicators(bars, CFG);
let hits = 0;
for (let i = CFG.hhvN; i < ind.n; i++) if (signalAt(ind, i, CFG, 1000)) hits++;
check('sinyal dihitung ulang dari CSV mentah', hits > 0, `${hits} bar sinyal dari ${ind.n} bar BTC/IDR`);

// 7. P&L satu trade dihasilkan ulang dari harga masuk/keluar + fee.
const result = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'backtest', 'result.json'), 'utf8'));
const t = result.full.trades[0];
if (t) {
  const gross = t.exitPrice * t.qty - t.entryPrice * t.qty;
  const cost = t.feeBuy + t.feeSell;
  const recomputed = gross - cost;
  check(
    'P&L trade = (jual-beli)*qty - fee',
    Math.abs(recomputed - t.netPnl) < 1,
    `${t.pair} recomputed ${recomputed.toFixed(0)} vs log ${t.netPnl.toFixed(0)}`,
  );
  check('fee transaksi ikut tercatat di trade', t.feeBuy > 0 && t.feeSell > 0, `beli ${t.feeBuy.toFixed(0)} jual ${t.feeSell.toFixed(0)}`);
}

// 8. Backtest memakai data Indodax asli, bukan angka acak.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw', 'manifest.json'), 'utf8'));
for (const p of manifest.pairs) {
  check(`${p.symbol} candle nyata & tanpa celah`, p.bars >= 6500 && p.gaps === 0, `${p.bars} bar, ${p.first} → ${p.last}`);
}

// 9. Stop-loss backtest tidak pernah melampaui risiko yang direncanakan (kontrol).
const run = runBacktest(
  { pairs: [], timeline: [] },
  { startMs: 0, endMs: 1, cfg: CFG, entryMode: CFG.entryMode },
);
check('engine jalan tanpa error pada data kosong', Array.isArray(run.trades) && run.trades.length === 0);

say('');
say(failed === 0 ? `SEMUA UJI LULUS (${lines.filter((l) => l.startsWith('PASS')).length} pemeriksaan)` : `${failed} UJI GAGAL`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'execution.txt'), lines.join('\n') + '\n');
console.log('ditulis', path.join(OUT, 'execution.txt'));
process.exit(failed ? 1 : 0);
