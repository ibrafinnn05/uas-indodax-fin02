import { WIB_OFFSET_MS } from './time.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(+v)) return '—';
  const n = +v;
  const neg = n < 0;
  const s = Math.abs(n).toFixed(d);
  const [ip, fp] = s.split('.');
  const grp = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + grp + (d > 0 ? ',' + fp : '');
}

export function fmtInt(v) {
  return fmtNum(v, 0);
}

export function fmtPct(v, d = 2) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return fmtNum(+v * 100, d) + '%';
}

export function fmtRp(v, d = 0) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return (v < 0 ? '-Rp ' : 'Rp ') + fmtNum(Math.abs(+v), d);
}

export function fmtBps(v, d = 1) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return fmtNum(+v, d) + ' bp';
}

export function fmtDate(ts) {
  if (ts == null) return '—';
  const d = new Date(+new Date(ts) + WIB_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '—';
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

export function fmtShort(ts) {
  const d = new Date(+new Date(ts) + WIB_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '—';
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()];
}

export function fmtDateTime(ts) {
  if (ts == null) return '—';
  const d = new Date(+new Date(ts) + WIB_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '—';
  return fmtDate(ts) + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' WIB';
}

const signCls = (v) => (v == null || !Number.isFinite(+v) ? '' : +v > 0 ? 'pos' : +v < 0 ? 'neg' : 'flat');

function pill(text, kind = 'muted') {
  return `<span class="pill ${kind}">${esc(text)}</span>`;
}

function card(title, body, sub = '') {
  return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>${body}</section>`;
}

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function sample(points, max = 620) {
  if (!points || points.length <= max) return points || [];
  const step = Math.ceil(points.length / max);
  const out = [points[0]];
  for (let i = step; i < points.length - 1; i += step) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

export function lineChart({ series, height = 300, width = 1040, yFmt = (v) => fmtNum(v, 0), area = false }) {
  const clean = (series || [])
    .map((s) => ({
      ...s,
      points: sample((s.points || []).filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]))),
    }))
    .filter((s) => s.points.length >= 2);
  if (!clean.length) return `<div class="empty">Belum ada cukup data untuk grafik.</div>`;

  const pad = { l: 62, r: 18, t: 16, b: 30 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const all = clean.flatMap((s) => s.points);
  let xmin = Math.min(...all.map((p) => +p[0]));
  let xmax = Math.max(...all.map((p) => +p[0]));
  let ymin = Math.min(...all.map((p) => +p[1]));
  let ymax = Math.max(...all.map((p) => +p[1]));
  if (xmax === xmin) xmax = xmin + 1;
  if (ymax === ymin) {
    ymax += 1;
    ymin -= 1;
  }
  const ypad = (ymax - ymin) * 0.08;
  ymin -= ypad;
  ymax += ypad;
  const X = (ts) => pad.l + ((+ts - xmin) / (xmax - xmin)) * iw;
  const Y = (v) => pad.t + ih - ((+v - ymin) / (ymax - ymin)) * ih;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ih * i) / 4;
    const val = ymax - ((ymax - ymin) * i) / 4;
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + iw}" y2="${y.toFixed(1)}" class="grid"/>`;
    grid += `<text x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" class="axis" text-anchor="end">${esc(yFmt(val))}</text>`;
  }
  let xlabels = '';
  for (let i = 0; i <= 3; i++) {
    const ts = xmin + ((xmax - xmin) * i) / 3;
    const x = X(ts);
    xlabels += `<text x="${x.toFixed(1)}" y="${height - 8}" class="axis" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${esc(fmtShort(ts))}</text>`;
  }

  let paths = '';
  clean.forEach((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    if (area) {
      paths += `<path d="${d} L${X(s.points[s.points.length - 1][0]).toFixed(1)},${(pad.t + ih).toFixed(1)} L${X(s.points[0][0]).toFixed(1)},${(pad.t + ih).toFixed(1)} Z" fill="${s.color}" opacity="0.08"/>`;
    }
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = s.points[s.points.length - 1];
    paths += `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.color}"/>`;
  });

  const legend = clean
    .map((s) => {
      const last = s.points[s.points.length - 1][1];
      return `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.name)} <b>${esc(yFmt(last))}</b></span>`;
    })
    .join('');

  return `<div class="chart"><div class="legend">${legend}</div>
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="grafik">
<rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="none" class="frame"/>
${grid}${xlabels}${paths}
</svg></div>`;
}

function drawdownPoints(points) {
  let peak = -Infinity;
  const out = [];
  for (const p of points || []) {
    const ts = Array.isArray(p) ? p[0] : p.ts;
    const v = Array.isArray(p) ? p[1] : p.equity;
    if (!(v > 0)) continue;
    if (v > peak) peak = v;
    out.push([ts, (v / peak - 1) * 100]);
  }
  return out;
}

function normalize(points, base) {
  const arr = (points || [])
    .map((p) => (Array.isArray(p) ? p : [p.ts, p.equity]))
    .filter((p) => Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
  const b = base || (arr[0] ? arr[0][1] : 100);
  return arr.map(([ts, v]) => [ts, (v / b) * 100]);
}

function table(headers, rows, { cls = '', foot = '' } = {}) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c == null ? '—' : c}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="${cls}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${foot ? `<div class="foot">${foot}</div>` : ''}`;
}

function statusBadge(f) {
  if (f.status === 'complete') return pill('FORWARD SELESAI', 'ok');
  if (f.status === 'running') return pill('FORWARD BERJALAN', 'warn');
  if (f.status === 'menunggu_candle') return pill('MENUNGGU CANDLE', 'warn');
  return pill('FORWARD BELUM MULAI', 'muted');
}

function progressBar(frac, color = '#38bdf8') {
  const p = Math.max(0, Math.min(1, frac || 0));
  return `<div class="bar"><span style="width:${(p * 100).toFixed(1)}%;background:${color}"></span></div>`;
}

export function renderHtml(model) {
  const m = model;
  const bt = m.backtest;
  const f = m.forward;
  const full = bt?.full?.metrics || {};
  const is = bt?.is?.metrics || {};
  const oos = bt?.oos?.metrics || {};
  const w10 = bt?.window10?.metrics || {};
  const w = f.window && f.window.metrics ? f.window : null;
  const wm = w?.metrics || null;
  const fm = f.metrics || {};
  const gap = f.gap;
  const ops = f.ops || {};
  const state = f.state;
  const day = state?.day;

  const daysLeft = Math.max(0, 10 - (f.daysElapsed || 0));
  const lateFreeze = m.freeze.late === true;

  const disclosure = `
  <div class="alert ${lateFreeze || f.status !== 'complete' ? 'warn' : 'ok'}">
    <div class="alert-title">${lateFreeze ? 'Freeze terlambat — dicatat jujur' : 'Catatan integritas data'}</div>
    <p>
      Freeze dilakukan <b>${esc(fmtDateTime(m.freeze.freezeAt))}</b>${lateFreeze ? ', melewati jadwal UAS 4 November 2026 12.00 WIB' : ''}.
      Data candle berhenti di <b>${esc(fmtDateTime(m.freeze.dataCutoff))}</b>.
      ${f.status === 'complete'
        ? 'Forward test sudah mencakup 10 hari penuh.'
        : `Forward test baru berjalan <b>${fmtNum(f.daysElapsed, 2)} hari</b> dari 10 hari${f.startedAt ? ` (mulai ${esc(fmtDateTime(f.startedAt))})` : ''}. Angka forward di bawah adalah <b>hasil sementara</b>, bukan hasil final 10 hari.`}
      Tidak ada angka forward yang ditulis manual: seluruhnya dihitung dari log mentah di <code>logs/raw/</code>.
    </p>
  </div>`;

  const kpis = `
  <div class="kpi-grid">
    ${kpi('Backtest 3 tahun · return', `<span class="${signCls(full.totalReturn)}">${fmtPct(full.totalReturn)}</span>`, `${esc(bt?.meta?.start?.slice(0, 10) || '')} → ${esc(bt?.meta?.end?.slice(0, 10) || '')}`)}
    ${kpi('Backtest · CAGR', `<span class="${signCls(full.cagr)}">${fmtPct(full.cagr)}</span>`, 'annualized, 3,0 tahun')}
    ${kpi('Backtest · max drawdown', `<span class="neg">${fmtPct(full.mdd)}</span>`, 'equity close-to-close')}
    ${kpi('Forward · return', `<span class="${signCls(fm.totalReturn)}">${fmtPct(fm.totalReturn)}</span>`, f.status === 'complete' ? '10 hari penuh' : `${fmtNum(f.daysElapsed, 2)} hari berjalan`)}
    ${kpi('Forward · max drawdown', `<span class="neg">${fmtPct(fm.mdd)}</span>`, `${fm.points || 0} titik equity harian`)}
    ${kpi('BTC buy & hold 3 tahun', `<span class="${signCls(full.benchmark?.totalReturn)}">${fmtPct(full.benchmark?.totalReturn)}</span>`, `MDD ${fmtPct(full.benchmark?.mdd)}`, 'bench')}
    ${kpi('Profit factor', fm.n ? fmtNum(fm.pf, 2) : '—', fm.n ? `${fm.wins || 0} menang / ${fm.losses || 0} kalah` : 'belum ada trade forward')}
    ${kpi('Porsi biaya', fm.costShare != null ? fmtPct(fm.costShare) : fmtPct(full.costShare), fm.n ? 'forward: biaya / laba kotor' : 'backtest 3 tahun')}
  </div>`;

  const eqSeries = bt
    ? [
        { name: 'FINN 02 (backtest)', color: '#38bdf8', points: normalize(bt.full.equity, m.config.startEquity), width: 2.2 },
        { name: 'BTC/IDR buy & hold', color: '#fbbf24', points: normalize(bt.full.benchmarkPoints, m.config.startEquity), width: 1.6 },
      ]
    : [];
  const ddSeries = bt
    ? [{ name: 'Drawdown FINN 02', color: '#f87171', points: drawdownPoints(bt.full.equity), width: 1.8 }]
    : [];

  const equityCard = card(
    'Kurva equity backtest vs benchmark',
    lineChart({ series: eqSeries, height: 320, area: true }) +
      `<div class="chart-note">Diindeks ke 100 pada awal periode. Backtest memakai candle 4 jam Indodax, fill bid/ask, fee taker all-in, spread & slippage hasil snapshot.</div>` +
      lineChart({ series: ddSeries, height: 170, yFmt: (v) => fmtNum(v, 1) + '%', area: true }),
    '3 tahun · 4 jam',
  );

  const compareRows = [
    ['Return total', fmtPct(wm?.totalReturn), fmtPct(fm.totalReturn), gap ? fmtPct(gap.totalReturn) : '—', `${fmtPct(wm?.benchmark?.totalReturn)}`],
    ['Max drawdown', fmtPct(wm?.mdd), fmtPct(fm.mdd), gap ? fmtPct(gap.mdd) : '—', `${fmtPct(wm?.benchmark?.mdd)}`],
    ['Profit factor', wm?.pf != null ? fmtNum(wm.pf, 2) : '—', fm.pf != null ? fmtNum(fm.pf, 2) : '—', gap?.pf != null ? fmtNum(gap.pf, 2) : '—', '—'],
    ['Win rate', fmtPct(wm?.win), fmtPct(fm.win), gap ? fmtPct(gap.win) : '—', '—'],
    ['Rata-rata untung', fmtPct(wm?.avgWin), fmtPct(fm.avgWin), '—', '—'],
    ['Rata-rata rugi', fmtPct(wm?.avgLoss), fmtPct(fm.avgLoss), '—', '—'],
    ['Jumlah trade', wm ? fmtInt(wm.n) : '—', fmtInt(fm.n), gap ? (gap.trades >= 0 ? '+' : '') + fmtInt(gap.trades) : '—', '—'],
    ['Porsi biaya', fmtPct(wm?.costShare), fmtPct(fm.costShare), '—', '—'],
    ['Sinyal cocok', w?.compare ? (w.compare.expected + w.compare.actual === 0 ? '0 sinyal' : `${w.compare.matched}/${w.compare.expected} (${fmtPct(w.compare.matchRate, 0)})`) : '—', '—', '—', '—'],
  ];

  const compareCard = card(
    'Perbandingan apel-ke-apel: backtest vs forward',
    w
      ? `<div class="notice">Backtest dijalankan ulang dari candle yang sama dengan candle yang diproses bot: <b>${esc(fmtDateTime(w.startMs))}</b> → <b>${esc(fmtDateTime(w.endMs))}</b>. ${gap?.partial ? '<b>Jendela masih parsial</b> karena forward belum 10 hari.' : ''}</div>` +
        table(['Metrik', 'Backtest jendela', 'Forward aktual', 'Selisih', 'BTC benchmark'], compareRows, {
          foot: w.compare && w.compare.expected + w.compare.actual === 0
            ? 'Tidak ada sinyal pada jendela ini; tidak ada sinyal yang perlu dicocokkan. Setiap skip tetap tercatat di log sinyal.'
            : `Cocok sinyal candle-demi-candle: <b>${esc(w.compare?.matched ?? 0)}/${esc(w.compare?.expected ?? 0)}</b>. Sinyal hilang: ${esc((w.compare?.missing || []).length)} · sinyal ekstra: ${esc((w.compare?.extra || []).length)}.`,
        })
      : `<div class="empty">Belum ada candle yang diproses bot, jadi belum ada jendela forward untuk dibandingkan. Backtest 10 hari terakhir sebelum freeze tetap ditampilkan sebagai referensi di bawah.</div>`,
    gap ? `${fmtNum(gap.days, 2)} hari · parsial` : 'menunggu log',
  );

  const refCard = card(
    'Referensi: backtest 10 hari terakhir sebelum freeze',
    `<div class="notice">Jendela ini berakhir tepat di freeze dan <b>bukan</b> jendela forward. Fungsinya hanya menunjukkan perilaku strategi pada 10 hari terakhir data sebelum pembekuan.</div>` +
      table(
        ['Metrik', 'Nilai', 'Pembanding BTC'],
        [
          ['Return', fmtPct(w10.totalReturn), fmtPct(w10.benchmark?.totalReturn)],
          ['Max drawdown', fmtPct(w10.mdd), fmtPct(w10.benchmark?.mdd)],
          ['Jumlah trade', fmtInt(w10.n), '—'],
          ['Profit factor', w10.pf != null ? fmtNum(w10.pf, 2) : '—', '—'],
          ['Win rate', fmtPct(w10.win), '—'],
        ],
        { foot: `Jendela: ${esc(bt?.meta?.window10?.start?.slice(0, 10) || '—')} → ${esc(bt?.meta?.window10?.end?.slice(0, 10) || '—')}.` },
      ),
    'hanya referensi',
  );

  const oosCard = card(
    'Validasi out-of-sample',
    table(
      ['Periode', 'CAGR', 'Return', 'MDD', 'PF', 'Trade'],
      [
        ['In-sample · 2023-11 → 2025-11', fmtPct(is.cagr), fmtPct(is.totalReturn), fmtPct(is.mdd), fmtNum(is.pf, 2), fmtInt(is.n)],
        ['Out-of-sample · 2025-11 → freeze', fmtPct(oos.cagr), fmtPct(oos.totalReturn), fmtPct(oos.mdd), fmtNum(oos.pf, 2), fmtInt(oos.n)],
        ['Penuh · 3 tahun', fmtPct(full.cagr), fmtPct(full.totalReturn), fmtPct(full.mdd), fmtNum(full.pf, 2), fmtInt(full.n)],
        ['BTC buy & hold · 3 tahun', '—', fmtPct(full.benchmark?.totalReturn), fmtPct(full.benchmark?.mdd), '—', '—'],
      ],
      { foot: 'OOS adalah bukti paling kuat yang tersedia sebelum forward lengkap. Tidak ada parameter yang diubah setelah freeze.' },
    ),
    'bukti sebelum deploy',
  );

  const cost = m.costs;
  const costRows = [
    ['Fee beli', fmtRp(cost.backtest.feeBuy), fmtRp(cost.backtestWindow?.feeBuy), fmtRp(cost.forward.feeBuy)],
    ['Fee jual', fmtRp(cost.backtest.feeSell), fmtRp(cost.backtestWindow?.feeSell), fmtRp(cost.forward.feeSell)],
    ['Spread', fmtRp(cost.backtest.spread), fmtRp(cost.backtestWindow?.spread), fmtRp(cost.forward.spread)],
    ['Slippage', fmtRp(cost.backtest.slip), fmtRp(cost.backtestWindow?.slip), fmtRp(cost.forward.slip)],
    ['Total biaya', `<b>${fmtRp(cost.backtest.total)}</b>`, `<b>${fmtRp(cost.backtestWindow?.total)}</b>`, `<b>${fmtRp(cost.forward.total)}</b>`],
    ['Biaya / notional', fmtBps(cost.backtest.totalBps), fmtBps(cost.backtestWindow?.totalBps), fmtBps(cost.forward.totalBps)],
    ['Porsi laba kotor', fmtPct(full.costShare), fmtPct(wm?.costShare), fmtPct(fm.costShare)],
  ];
  const costCard = card(
    'Rincian biaya: fee + spread + slippage',
    table(['Komponen', 'Backtest 3 th', 'Backtest jendela', 'Forward'], costRows, {
      foot: `Fee beli ${fmtPct(m.config.feeBuy, 3)} dan jual ${fmtPct(m.config.feeSell, 3)} (taker all-in IDR PRO, berlaku 1 Okt 2026). Sumber: /api/pairs dan halaman resmi Indodax; dipakai angka yang lebih mahal.`,
    }),
    'semua angka rupiah dari log',
  );

  const spreadRows = (f.spread || []).map((s) => [
    esc(s.symbol || s.pair),
    fmtBps(s.backtestBps),
    fmtBps(s.forwardBps),
    fmtInt(s.forwardN),
    fmtBps(s.buySlipBps),
    fmtBps(s.sellSlipBps),
  ]);
  const spreadCard = card(
    'Spread: snapshot backtest vs snapshot forward',
    table(['Pair', 'Backtest (median)', 'Forward (median)', 'Snapshot', 'Buy slip 25 jt', 'Sell slip 25 jt'], spreadRows, {
      foot: `Backtest memakai median dari ${fmtInt(m.depthMeta?.pairs ? Object.values(m.depthMeta.pairs).reduce((a, x) => a + (x.n || 0), 0) : 0)} snapshot order book yang dikumpulkan sebelum freeze. Forward memakai setiap snapshot yang tercatat saat bot berjalan.`,
    }),
    `${fmtInt(f.raw.spreads)} snapshot forward`,
  );

  const opsCard = card(
    'Panel operasional',
    `<div class="ops-grid">
      <div class="ops-item"><span>Status</span><b>${statusBadge(f)}</b></div>
      <div class="ops-item"><span>Uptime candle</span><b>${fmtPct(ops.uptime, 1)}</b>${progressBar(ops.uptime, '#34d399')}<small>${fmtInt(ops.executed)} / ${fmtInt(ops.expected)} candle</small></div>
      <div class="ops-item"><span>Panggilan tercatat</span><b>${fmtInt(ops.calls)}</b><small>${fmtInt(f.raw.calls)} di log mentah</small></div>
      <div class="ops-item"><span>Error API / data</span><b class="${ops.errors ? 'neg' : 'pos'}">${fmtInt(ops.errors)}</b><small>retry dibatasi 3×</small></div>
      <div class="ops-item"><span>Kill switch</span><b class="${ops.killSwitchUses ? 'neg' : ''}">${fmtInt(ops.killSwitchUses)}×</b><small>${state?.killSwitch ? 'AKTIF' : 'nonaktif'}</small></div>
      <div class="ops-item"><span>Equity state</span><b>${fmtRp(state?.equity ?? fm.endEquity)}</b><small>kas ${fmtRp(state?.cash)}</small></div>
      <div class="ops-item"><span>Posisi / pending</span><b>${fmtInt(state?.positions?.length || 0)} / ${fmtInt(state?.pending?.length || 0)}</b><small>maks ${m.config.maxPositions} slot</small></div>
      <div class="ops-item"><span>Daily loss limit</span><b class="${day?.blocked ? 'neg' : 'pos'}">${day?.blocked ? 'TERBLOKIR' : 'aman'}</b><small>${esc(day?.date || '—')} · batas ${fmtPct(m.config.dailyLossLimit)}</small></div>
      <div class="ops-item"><span>Tick terakhir</span><b>${esc(fmtDateTime(state?.lastTick?.ts || f.now))}</b><small>${fmtInt(state?.lastTick?.pairsOk)} pair OK · ${fmtInt(state?.lastTick?.pairsInvalid)} invalid</small></div>
      <div class="ops-item"><span>Candle diproses</span><b>${fmtInt(f.raw.processedCandles)}</b><small>idempotent per candle</small></div>
    </div>`,
    'uptime = candle diproses sebelum candle berikutnya tutup',
  );

  const windowChartSeries = [];
  if (w10 && bt?.window10?.equity) {
    windowChartSeries.push({ name: 'Backtest 10 hari (referensi)', color: '#a78bfa', points: normalize(bt.window10.equity, m.config.startEquity), width: 2 });
  }
  if (w && w.metrics?.equity) {
    windowChartSeries.push({ name: 'Backtest jendela forward', color: '#38bdf8', points: normalize(w.metrics.equity, m.config.startEquity), width: 2 });
  }
  if (f.equityPoints && f.equityPoints.length >= 2) {
    windowChartSeries.push({ name: 'Forward aktual', color: '#34d399', points: normalize(f.equityPoints, m.config.startEquity), width: 2.2 });
  }
  const windowChartCard = card(
    'Jendela pendek: backtest vs forward',
    lineChart({ series: windowChartSeries, height: 280, yFmt: (v) => fmtNum(v, 1) }) +
      `<div class="chart-note">Backtest 10 hari sebelum freeze (violet), backtest pada candle yang sama dengan bot (biru), dan equity forward aktual (hijau). Semua diindeks ke 100 di awal masing-masing.</div>`,
    'fokus kecocokan',
  );

  const fwOrders = (f.orders || []).slice().reverse().slice(0, 40);
  const orderRows = fwOrders.map((o) => {
    const side = o.side === 'buy' ? pill('BELI', 'buy') : pill('JUAL', 'sell');
    return [
      esc(fmtDateTime(o.ts)),
      esc(o.pair),
      side,
      fmtNum(o.qty, 8),
      fmtRp(o.price),
      fmtRp(o.notional),
      fmtRp(o.fee),
      fmtRp(o.spreadCost),
      o.side === 'sell' && Number.isFinite(o.netPnl) ? `<span class="${signCls(o.netPnl)}">${fmtRp(o.netPnl)}</span>` : '—',
      esc(o.reason || ''),
    ];
  });
  const ordersCard = card(
    'Order simulasi forward (log mentah)',
    orderRows.length
      ? table(['Waktu', 'Pair', 'Sisi', 'Qty', 'Harga fill', 'Notional', 'Fee', 'Spread', 'P&L', 'Alasan'], orderRows)
      : `<div class="empty">Belum ada order. Bot hanya membuka posisi bila sinyal HHV20 + tren + likuiditas terpenuhi dan limit terisi di ask.</div>`,
    `${fmtInt(f.raw.orders)} order`,
  );

  const fwSignals = (f.signals || []).slice().reverse().slice(0, 30);
  const signalRows = fwSignals.map((s) => [
    esc(fmtDateTime(s.ts)),
    esc(s.pair),
    s.action === 'signal' ? pill(s.mode === 'market' ? 'MARKET' : 'LIMIT', 'info') : pill(esc(s.action).toUpperCase(), 'muted'),
    s.candle ? esc(fmtDateTime(+s.candle * 1000)) : '—',
    s.limit != null ? fmtRp(s.limit) : '—',
    s.close != null ? fmtRp(s.close) : '—',
    esc(s.reason || (s.mode ? `mode ${s.mode}` : '')),
  ]);
  const signalsCard = card(
    'Sinyal & keputusan forward',
    signalRows.length
      ? table(['Waktu log', 'Pair', 'Aksi', 'Candle', 'Limit', 'Close', 'Alasan'], signalRows)
      : `<div class="empty">Belum ada sinyal/log keputusan. Setiap skip (spread, slot penuh, daily loss, kill switch) juga akan tercatat di sini.</div>`,
    `${fmtInt(f.raw.signals)} baris`,
  );

  const bwTrades = (w?.trades || []).slice().reverse().slice(0, 20);
  const bwRows = bwTrades.map((t) => [
    esc(t.pair),
    esc(fmtDateTime(t.entryTs)),
    esc(fmtDateTime(t.exitTs)),
    fmtRp(t.entryPrice),
    fmtRp(t.exitPrice),
    `<span class="${signCls(t.ret)}">${fmtPct(t.ret)}</span>`,
    `<span class="${signCls(t.netPnl)}">${fmtRp(t.netPnl)}</span>`,
    esc(t.reason),
  ]);
  const bwCard = card(
    'Trade backtest pada jendela forward',
    bwRows.length
      ? table(['Pair', 'Masuk', 'Keluar', 'Harga masuk', 'Harga keluar', 'Return', 'P&L', 'Alasan'], bwRows)
      : `<div class="empty">Tidak ada trade backtest pada jendela ini.</div>`,
    w ? `${fmtInt(wm.n)} trade` : 'belum ada jendela',
  );

  const universeRows = (m.universe || []).map((u) => [
    `<b>${esc(u.symbol)}</b>`,
    esc(u.pair),
    fmtInt(u.tick),
    fmtNum(u.qtyStep, 8),
    fmtBps(u.spreadBps),
    fmtBps(u.buySlipBps),
    fmtBps(u.sellSlipBps),
  ]);
  const universeCard = card(
    'Universe beku & provenance',
    table(['Pair', 'ID', 'Tick', 'Qty step', 'Spread', 'Buy slip', 'Sell slip'], universeRows) +
      `<div class="foot">${esc(m.universeMeta?.method || '')} Kandidat dengan data: ${fmtInt(m.universeMeta?.candidatesWithData)} dari ${fmtInt(m.universeMeta?.candidatesChecked)}. ${esc(m.universeMeta?.note || '')}</div>`,
    `${(m.universe || []).length} pair · likuiditas awal periode`,
  );

  const paramRows = Object.entries(m.config)
    .map(([k, v]) => `<div class="param"><span>${esc(k)}</span><b>${esc(typeof v === 'number' ? fmtNum(v, String(v).includes('.') ? 4 : 0) : String(v))}</b></div>`)
    .join('');
  const paramsCard = card(
    'Parameter beku',
    `<div class="params">${paramRows}</div>`,
    'tidak diubah setelah freeze',
  );

  const errorRows = (f.errors || []).slice().reverse().map((e) => [esc(fmtDateTime(e.ts)), esc(e.error || e.message || '')]);
  const errorCard = errorRows.length
    ? card('Error tercatat', table(['Waktu', 'Error'], errorRows), `${errorRows.length} baris terakhir`)
    : '';

  const rawCard = card(
    'Hitung ulang & sumber angka',
    `<div class="recompute">
      <p>Dashboard ini dibangun dari file mentah, bukan angka yang ditulis tangan:</p>
      <ul>
        <li><code>data/raw/*_240.csv</code> — candle 4 jam 3 tahun (${fmtInt(6579)} bar per pair).</li>
        <li><code>logs/raw/calls.jsonl</code>, <code>orders.jsonl</code>, <code>signals.jsonl</code>, <code>equity.jsonl</code>, <code>errors.jsonl</code>, <code>spreads.jsonl</code> — log forward.</li>
        <li><code>logs/raw/state.json</code> — snapshot state terakhir.</li>
        <li><code>data/depth/raw/*.json</code> — snapshot order book untuk spread/slippage.</li>
      </ul>
      <pre>npm run hitung      # hitung ulang backtest + forward + dashboard
npm run dashboard   # tulis ulang public/index.html
npm run zip         # paket ZIP termasuk .git</pre>
      <p class="muted">Sumber log: <b>${esc(f.source)}</b> · manifest: <b>${esc(m.reconciliation?.manifest?.exportedAt || '—')}</b> · dibuat ${esc(fmtDateTime(m.generatedAt))}.</p>
    </div>`,
    'reproducible',
  );

  const lastTick = state?.lastTick?.ts ? fmtDateTime(state.lastTick.ts) : '—';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FINN 02 · Indodax Dry Run — Dashboard</title>
<style>
:root{
  --bg:#080e1a;--bg2:#0d1526;--card:#111c31;--card2:#0e1729;--line:rgba(148,163,184,.16);
  --text:#e8eefc;--muted:#93a4c3;--dim:#6b7d9e;
  --cyan:#38bdf8;--violet:#a78bfa;--green:#34d399;--red:#f87171;--amber:#fbbf24;
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,rgba(56,189,248,.10),transparent),radial-gradient(900px 500px at 100% 0,rgba(167,139,250,.08),transparent),var(--bg);color:var(--text);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:28px 22px 60px}
header.top{display:flex;gap:18px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;padding:6px 0 22px;border-bottom:1px solid var(--line);margin-bottom:22px}
.brand h1{margin:0;font-size:26px;letter-spacing:-.4px}
.brand h1 span{color:var(--cyan)}
.brand p{margin:6px 0 0;color:var(--muted);font-size:13px;max-width:820px}
.meta{text-align:right;color:var(--muted);font-size:12px;line-height:1.8}
.meta b{color:var(--text)}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.4px;border:1px solid transparent;white-space:nowrap}
.pill.ok{background:rgba(52,211,153,.12);color:#6ee7b7;border-color:rgba(52,211,153,.3)}
.pill.warn{background:rgba(251,191,36,.12);color:#fcd34d;border-color:rgba(251,191,36,.3)}
.pill.muted{background:rgba(148,163,184,.1);color:#b6c2d9;border-color:rgba(148,163,184,.2)}
.pill.info{background:rgba(56,189,248,.12);color:#7dd3fc;border-color:rgba(56,189,248,.3)}
.pill.buy{background:rgba(52,211,153,.12);color:#6ee7b7;border-color:rgba(52,211,153,.3)}
.pill.sell{background:rgba(248,113,113,.12);color:#fca5a5;border-color:rgba(248,113,113,.3)}
.alert{border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 20px;background:linear-gradient(180deg,rgba(251,191,36,.08),rgba(17,28,49,.6))}
.alert.ok{background:linear-gradient(180deg,rgba(52,211,153,.08),rgba(17,28,49,.6))}
.alert-title{font-weight:800;letter-spacing:.3px;font-size:12px;text-transform:uppercase;color:var(--amber);margin-bottom:4px}
.alert.ok .alert-title{color:var(--green)}
.alert p{margin:0;color:#c8d5ea;font-size:13px}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
code{background:rgba(148,163,184,.12);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px;color:#c7d7f2}
pre{background:#070d18;border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow:auto;color:#9fd7ff;font-size:12px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.kpi{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:14px;padding:14px 15px;min-height:96px}
.kpi.bench{border-color:rgba(251,191,36,.18)}
.kpi-label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.45px;font-weight:700}
.kpi-value{font-size:25px;font-weight:800;letter-spacing:-.5px;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.kpi-sub{color:var(--dim);font-size:11.5px}
.pos{color:var(--green)}.neg{color:var(--red)}.flat{color:var(--muted)}
.card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:16px;padding:16px 17px;margin-bottom:16px;box-shadow:0 20px 50px -30px rgba(0,0,0,.8)}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.card-head h2{margin:0;font-size:15px;letter-spacing:.2px}
.sub{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.grid2{display:grid;grid-template-columns:1.35fr .95fr;gap:16px}
.grid2>*{min-width:0}
.chart{position:relative}
.chart svg{width:100%;height:auto;display:block}
.grid line,.grid{stroke:rgba(148,163,184,.12)}
.frame{stroke:rgba(148,163,184,.16)}
.axis{fill:#7e91b3;font-size:11px;font-family:ui-monospace,Consolas,monospace}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:2px 0 8px;font-size:11.5px;color:var(--muted)}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.legend-item i{width:10px;height:3px;border-radius:2px;display:inline-block}
.legend-item b{color:var(--text);font-variant-numeric:tabular-nums}
.chart-note{color:var(--dim);font-size:11.5px;margin:4px 0 10px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:11px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th{position:sticky;top:0;background:#0f1a2d;color:#a9bbd8;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.08);color:#d8e3f5;white-space:nowrap;font-variant-numeric:tabular-nums}
tbody tr:hover td{background:rgba(56,189,248,.04)}
tbody tr:last-child td{border-bottom:none}
.foot{color:var(--dim);font-size:11.5px;margin-top:8px}
.notice{background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.16);border-radius:10px;padding:9px 12px;color:#b9d9f5;font-size:12px;margin-bottom:10px}
.empty{color:var(--dim);font-size:12.5px;border:1px dashed var(--line);border-radius:11px;padding:22px;text-align:center;background:rgba(148,163,184,.03)}
.ops-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.ops-item{border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:rgba(148,163,184,.03)}
.ops-item>span{display:block;color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:3px}
.ops-item>b{font-size:14px}
.ops-item small{display:block;color:var(--dim);font-size:10.5px;margin-top:2px}
.bar{height:5px;border-radius:99px;background:rgba(148,163,184,.15);margin:6px 0 4px;overflow:hidden}
.bar span{display:block;height:100%;border-radius:99px}
.params{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.param{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:rgba(148,163,184,.03);display:flex;justify-content:space-between;gap:8px}
.param span{color:var(--muted);font-size:11px}
.param b{font-size:11.5px;color:#dbe7fb}
.recompute p{margin:0 0 8px;color:#c8d5ea}
.recompute ul{margin:0 0 10px;padding-left:18px;color:#b9c8e2;font-size:12.5px}
.recompute li{margin:3px 0}
.muted{color:var(--dim);font-size:11.5px}
footer{color:var(--dim);font-size:11.5px;text-align:center;padding-top:8px}
@media (max-width:1000px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.params{grid-template-columns:repeat(2,1fr)}}
@media (max-width:620px){.wrap{padding:18px 12px 40px}.kpi-value{font-size:21px}.ops-grid{grid-template-columns:1fr}.params{grid-template-columns:1fr}.meta{text-align:left}}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <div class="brand">
    <h1>FINN 02 <span>·</span> Indodax Dry Run</h1>
    <p>Strategi breakout HHV20 + limit buy, long-only, timeframe 4 jam, universe 5 pair IDR likuid. Bot memakai API publik Indodax tanpa API key; semua fill disimulasikan pada bid/ask order book.</p>
  </div>
  <div class="meta">
    <div>${statusBadge(f)}</div>
    <div>Dibuat <b>${esc(fmtDateTime(m.generatedAt))}</b></div>
    <div>Freeze <b>${esc(fmtDateTime(m.freeze.freezeAt))}</b></div>
    <div>Log <b>${esc(f.source)}</b></div>
  </div>
</header>

${disclosure}
${kpis}

${equityCard}

<div class="grid2">
  ${compareCard}
  ${opsCard}
</div>

${windowChartCard}

<div class="grid2">
  ${refCard}
  ${oosCard}
</div>

<div class="grid2">
  ${costCard}
  ${spreadCard}
</div>

${ordersCard}
${signalsCard}
${bwCard}

<div class="grid2">
  ${universeCard}
  ${paramsCard}
</div>

${errorCard}
${rawCard}

<footer>FINN 02 · UAS Algorithmic Trading · bot dry run Indodax · semua angka dapat dihitung ulang dari <code>logs/raw</code> dan <code>data/raw</code>.</footer>
</div>
</body>
</html>`;
}
