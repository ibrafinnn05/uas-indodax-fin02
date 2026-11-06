import path from 'node:path';
import { getStore } from '../lib/store.js';
import { logsFromStore, buildModel, readJson } from '../lib/report.js';
import { renderHtml } from '../lib/render.js';

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'method' });
  }
  const root = process.cwd();
  try {
    const backtest = readJson(path.join(root, 'data', 'backtest', 'result.json'));
    const freeze = readJson(path.join(root, 'data', 'freeze.json'), {});
    const depthSummary = readJson(path.join(root, 'data', 'depth', 'summary.json'), { pairs: {} });
    const store = getStore();
    const logs = await logsFromStore(store);
    const model = buildModel({
      root,
      logs,
      backtest,
      freeze,
      depthSummary,
      nowMs: Date.now(),
      includeWindowBacktest: false,
    });

    res.setHeader('Cache-Control', 'no-store');
    if (req.query?.format === 'json') {
      return res.status(200).json(model);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderHtml(model));
  } catch (e) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(
      '<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#0b1220;color:#e8eefc;padding:40px">' +
        '<h1>Dashboard gagal dimuat</h1><pre>' +
        String(e.message).replace(/</g, '&lt;') +
        '</pre><p>Periksa environment UPSTASH_REDIS_REST_URL/TOKEN.</p></body>',
    );
  }
}
