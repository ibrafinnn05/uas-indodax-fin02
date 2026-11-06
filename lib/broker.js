function parseLevels(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(([p, q]) => [+p, +q])
    .filter(([p, q]) => p > 0 && q > 0);
}

export function bestBid(depth) {
  const buy = parseLevels(depth?.buy);
  if (!buy.length) return null;
  return Math.max(...buy.map((x) => x[0]));
}

export function bestAsk(depth) {
  const sell = parseLevels(depth?.sell);
  if (!sell.length) return null;
  return Math.min(...sell.map((x) => x[0]));
}

export function midPrice(depth) {
  const b = bestBid(depth);
  const a = bestAsk(depth);
  if (!(b > 0) || !(a > 0)) return null;
  return (a + b) / 2;
}

export function spreadBps(depth) {
  const b = bestBid(depth);
  const a = bestAsk(depth);
  if (!(b > 0) || !(a > 0) || a < b) return null;
  return ((a - b) / ((a + b) / 2)) * 10000;
}

// Beli: habiskan ask terbaik lalu level berikutnya. notional dalam rupiah.
export function walkBuy(depth, notional) {
  const asks = parseLevels(depth?.sell).sort((x, y) => x[0] - y[0]);
  let left = notional;
  let qty = 0;
  let cost = 0;
  let levels = 0;
  for (const [p, q] of asks) {
    if (left <= 0) break;
    const levelNotional = p * q;
    const take = Math.min(left, levelNotional);
    const takeQty = take / p;
    qty += takeQty;
    cost += take;
    left -= take;
    levels++;
  }
  return {
    qty,
    notional: cost,
    vwap: qty > 0 ? cost / qty : null,
    levels,
    partial: left > 1e-6,
    unfilled: Math.max(0, left),
  };
}

// Jual: habiskan bid terbaik lalu level berikutnya. qty dalam unit kripto.
export function walkSell(depth, qty) {
  const bids = parseLevels(depth?.buy).sort((x, y) => y[0] - x[0]);
  let left = qty;
  let sold = 0;
  let proceeds = 0;
  let levels = 0;
  for (const [p, q] of bids) {
    if (left <= 0) break;
    const take = Math.min(left, q);
    sold += take;
    proceeds += take * p;
    left -= take;
    levels++;
  }
  return {
    qty: sold,
    notional: proceeds,
    vwap: sold > 0 ? proceeds / sold : null,
    levels,
    partial: left > 1e-12,
    unfilled: Math.max(0, left),
  };
}

export function fee(notional, rate) {
  return notional * rate;
}

export function pctDiff(a, b) {
  if (!(b > 0)) return null;
  return ((a - b) / b) * 100;
}
