// Satu-satunya fungsi sinyal yang dipakai backtest dan bot.
// Jangan menduplikasi logika ini di tempat lain.

export function floorTo(x, step) {
  if (!(step > 0)) return x;
  return Math.floor(x / step + 1e-12) * step;
}

export function floorTick(price, tick) {
  return floorTo(price, tick);
}

export function computeIndicators(candles, cfg) {
  const n = candles.length;
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const vol = new Float64Array(n);
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = +candles[i].Close;
    high[i] = +candles[i].High;
    low[i] = +candles[i].Low;
    vol[i] = +candles[i].Volume;
    time[i] = +candles[i].Time;
  }

  // ATR Wilder
  const atr = new Float64Array(n).fill(NaN);
  const tr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? close[i - 1] : close[i];
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc));
  }
  const N = cfg.atrN;
  if (n >= N) {
    let s = 0;
    for (let i = 0; i < N; i++) s += tr[i];
    atr[N - 1] = s / N;
    for (let i = N; i < n; i++) atr[i] = (atr[i - 1] * (N - 1) + tr[i]) / N;
  }

  // SMA MA50
  const ma = new Float64Array(n).fill(NaN);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += close[i];
    if (i >= cfg.maN) run -= close[i - cfg.maN];
    if (i >= cfg.maN - 1) ma[i] = run / cfg.maN;
  }

  // HHV dari N bar SEBELUM bar i (bukan termasuk bar i)
  const hhv = new Float64Array(n).fill(NaN);
  for (let i = cfg.hhvN; i < n; i++) {
    let mx = -Infinity;
    for (let q = i - cfg.hhvN; q < i; q++) if (high[q] > mx) mx = high[q];
    hhv[i] = mx;
  }

  // Median turnover 20 bar (close x volume, rupiah)
  const turn = new Float64Array(n).fill(NaN);
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.push(close[i] * vol[i]);
    if (buf.length > cfg.turnoverN) buf.shift();
    if (buf.length === cfg.turnoverN) {
      const s = buf.slice().sort((a, b) => a - b);
      const m = s.length >> 1;
      turn[i] = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
  }

  return { n, time, close, high, low, vol, atr, ma, hhv, turn };
}

export function signalAt(ind, i, cfg, tick) {
  if (i < Math.max(cfg.hhvN, cfg.maN, cfg.atrN, cfg.turnoverN)) return null;
  const c = ind.close[i];
  if (!(c > 0) || !(ind.high[i] > ind.low[i])) return null;
  if (!Number.isFinite(ind.hhv[i]) || !Number.isFinite(ind.ma[i]) || !Number.isFinite(ind.turn[i])) return null;
  if (!(ind.atr[i] > 0)) return null;
  if (!(c > ind.hhv[i])) return null; // breakout HHV20
  if (!(c > ind.ma[i])) return null; // filter tren
  if (!(ind.turn[i] >= cfg.minTurnover20)) return null;

  const strong = c >= ind.hhv[i] + cfg.strongAtr * ind.atr[i];
  const mode = cfg.entryMode === 'break'
    ? 'market'
    : cfg.entryMode === 'both'
      ? (strong ? 'market' : 'limit')
      : 'limit';

  return {
    i,
    time: +ind.time[i] || null,
    close: c,
    atr: ind.atr[i],
    hhv: ind.hhv[i],
    ma: ind.ma[i],
    turnover: ind.turn[i],
    strong,
    mode,
    limit: mode === 'limit' ? floorTick(c - cfg.limitAtr * ind.atr[i], tick) : null,
  };
}

export function sizePosition({ equity, cash, price, atr, tick, qtyStep, cfg }) {
  if (!(equity > 0) || !(cash > 0) || !(price > 0) || !(atr > 0)) return null;
  const stopDist = cfg.stopAtr * atr;
  if (!(stopDist > 0)) return null;

  let qty = (equity * cfg.riskPerTrade) / stopDist;
  qty = Math.min(qty, (equity * cfg.maxPerName) / price);
  qty = Math.min(qty, cash / (price * (1 + cfg.feeBuy)));
  qty = floorTo(qty, qtyStep);
  if (!(qty > 0)) return null;

  const notional = qty * price;
  if (notional < cfg.minOrderIdr) return null;
  return { qty, notional, stopDist, stop: price - stopDist };
}
