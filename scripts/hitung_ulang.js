import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeBacktestArtifacts } from './backtest.js';
import { logsFromFiles, buildModel, modelSummary } from '../lib/report.js';
import { renderHtml } from '../lib/render.js';

const ROOT = process.cwd();

// Menghasilkan ulang SEMUA angka dashboard dari sumber mentah:
// - data/raw/*_240.csv  (candle Indodax 3 tahun)
// - logs/raw/*.jsonl    (panggilan, order, sinyal, equity, error, spread forward)
// - data/depth/raw/*.json (snapshot order book)
// Tidak ada angka performa yang dibaca dari dashboard lama.
export function recompute({ root = ROOT, writeHtml = true } = {}) {
  const bt = writeBacktestArtifacts(root);
  const logs = logsFromFiles(root);
  const nowMs = Date.now();
  const model = buildModel({
    root,
    logs,
    backtest: bt,
    nowMs,
    includeWindowBacktest: true,
  });
  model.reconciliation.backtestSource = 'data/raw/*_240.csv (dihitung ulang saat skrip ini jalan)';
  const summary = modelSummary(model);

  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'data', 'recompute.json'),
    JSON.stringify({ generatedAt: new Date(nowMs).toISOString(), summary, model }, null, 1),
  );
  fs.writeFileSync(path.join(root, 'data', 'recompute.summary.json'), JSON.stringify(summary, null, 2));
  if (writeHtml) {
    fs.writeFileSync(path.join(root, 'public', 'index.html'), renderHtml(model));
  }
  return { model, summary };
}

function pct(x) {
  return x == null || !Number.isFinite(+x) ? '—' : (x * 100).toFixed(2) + '%';
}

function main() {
  const { model, summary } = recompute();
  const b = model.backtest.full.metrics;
  const f = model.forward.metrics;
  console.log('\n=== HITUNG ULANG DARI DATA MENTAH ===');
  console.log(`Backtest  : return ${pct(b.totalReturn)} · CAGR ${pct(b.cagr)} · MDD ${pct(b.mdd)} · PF ${b.pf?.toFixed(2)} · ${b.n} trade`);
  console.log(`OOS       : CAGR ${pct(model.backtest.oos.metrics.cagr)} · MDD ${pct(model.backtest.oos.metrics.mdd)}`);
  console.log(`Forward   : status ${model.forward.status} · ${model.forward.daysElapsed.toFixed(2)} hari · return ${pct(f.totalReturn)} · MDD ${pct(f.mdd)} · ${f.n} trade`);
  console.log(`Log mentah: ${JSON.stringify(model.forward.raw)}`);
  if (model.forward.window?.compare) {
    const c = model.forward.window.compare;
    console.log(`Sinyal    : ${c.matched}/${c.expected} cocok (${pct(c.matchRate)})`);
  }
  console.log(`Uptime    : ${pct(model.forward.ops.uptime)} (${model.forward.ops.executed}/${model.forward.ops.expected} candle)`);
  console.log('Ditulis   : data/backtest/result.json, data/recompute.json, public/index.html');
  console.log('Ringkasan :', JSON.stringify(summary.gap || null));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
