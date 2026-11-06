import { CFG, pairMeta } from './config.js';
import { getStore } from './store.js';
import { getServerTime, getHistory, getDepth, validateCandles } from './indodax.js';
import { computeIndicators, signalAt, sizePosition } from './strategy.js';
import { bestBid, bestAsk, midPrice, spreadBps, walkBuy, walkSell } from './broker.js';
import { initialState, rollDay, entryBlockReason } from './risk.js';
import { wibDateKey, TF_MS } from './time.js';

function num(x, d = 0) {
  return Number.isFinite(+x) ? +x : d;
}

async function loadMarket(store, serverTime, call) {
  const out = [];
  const fromSec = Math.floor(serverTime / 1000) - 200 * 240 * 60;
  const toSec = Math.floor(serverTime / 1000);
  for (const u of CFG.pairs) {
    const rec = { u, candlesOk: false, depthOk: false, errors: [] };
    try {
      const raw = await getHistory(u.symbol, '240', fromSec, toSec);
      const v = validateCandles(raw, serverTime, { minBars: CFG.minBars });
      if (!v.ok) {
        rec.reason = v.reason;
        call.errors.push(`${u.pair}: data candle tidak valid (${v.reason})`);
      } else {
        rec.candlesOk = true;
        rec.closed = v.closed;
        rec.last = v.last;
      }
    } catch (e) {
      rec.reason = 'history: ' + e.message;
      call.errors.push(`${u.pair}: ${rec.reason}`);
    }
    try {
      const depth = await getDepth(u.id);
      const bid = bestBid(depth);
      const ask = bestAsk(depth);
      const sp = spreadBps(depth);
      if (!(bid > 0) || !(ask > 0) || sp == null) {
        rec.reason = 'order book kosong';
        call.errors.push(`${u.pair}: order book kosong`);
      } else {
        rec.depth = depth;
        rec.bid = bid;
        rec.ask = ask;
        rec.mid = midPrice(depth);
        rec.spreadBps = sp;
        rec.depthOk = true;
        if (sp > CFG.maxSpreadBps) {
          rec.reason = `spread ${sp.toFixed(1)} bp > ${CFG.maxSpreadBps} bp`;
          call.errors.push(`${u.pair}: ${rec.reason}`);
        }
        await store.append('finn:depth', {
          ts: call.ts, pair: u.pair, bid, ask, spreadBps: sp,
          buy: depth.buy, sell: depth.sell,
        });
        // Ringkasan ringan supaya dashboard tidak perlu memuat seluruh buku.
        await store.append('finn:spreads', { ts: call.ts, pair: u.pair, bid, ask, spreadBps: sp });
      }
    } catch (e) {
      rec.reason = 'depth: ' + e.message;
      call.errors.push(`${u.pair}: ${rec.reason}`);
    }
    out.push(rec);
  }

  // Simpan snapshot candle tertutup ke log mentah (Redis / local store).
  // Tujuan: backtest jendela forward bisa dihitung ulang dari candle yang sama
  // dengan yang dilihat bot, tanpa mengubah data/raw yang sudah dibekukan.
  const candleSnapshot = { ts: call.ts, pairs: {} };
  for (const rec of out) {
    if (rec.candlesOk && Array.isArray(rec.closed) && rec.closed.length) {
      candleSnapshot.pairs[rec.u.pair] = rec.closed.map((b) => ({
        Time: b.Time, Open: b.Open, High: b.High, Low: b.Low, Close: b.Close, Volume: b.Volume,
      }));
    }
  }
  if (Object.keys(candleSnapshot.pairs).length) {
    try {
      await store.setValue('finn:candles', JSON.stringify(candleSnapshot));
      call.candleSnapshot = true;
    } catch (e) {
      call.errors.push('snapshot candle: ' + e.message);
    }
  }

  return out;
}

function equityAt(state, priceMap) {
  let v = state.cash;
  for (const [pair, pos] of Object.entries(state.positions || {})) {
    const px = priceMap.get(pair) ?? pos.lastPrice ?? pos.entryPrice;
    v += num(pos.qty) * num(px);
  }
  return v;
}

async function logSkip(store, call, pair, reason, extra = {}) {
  call.skips.push({ pair, reason, ...extra });
  await store.append('finn:signals', { ts: call.ts, pair, action: 'skip', reason, ...extra });
}

async function doBuy(market, atr, mode, reason, state, store, call) {
  const u = market.u;
  const equity = state.equity;
  const sz = sizePosition({
    equity, cash: state.cash, price: market.ask, atr,
    tick: u.tick, qtyStep: u.qtyStep, cfg: CFG,
  });
  if (!sz) return false;

  const targetNotional = sz.qty * market.ask;
  const fill = walkBuy(market.depth, targetNotional);
  if (!(fill.qty > 0)) return false;
  const notional = fill.notional;
  if (notional < CFG.minOrderIdr) {
    await logSkip(store, call, u.pair, 'minimum_order', { notional });
    return false;
  }
  // Kalau buku tidak cukup dalam, jangan paksa; catat.
  if (fill.partial && fill.notional < targetNotional * 0.9) {
    await logSkip(store, call, u.pair, 'likuiditas_order_book', { targetNotional, filled: fill.notional });
    return false;
  }
  const feeBuy = notional * CFG.feeBuy;
  if (state.cash < notional + feeBuy) {
    await logSkip(store, call, u.pair, 'kas_tidak_cukup', { notional, feeBuy, cash: state.cash });
    return false;
  }

  state.cash -= notional + feeBuy;
  const mid = market.mid;
  const pos = {
    pair: u.pair,
    qty: fill.qty,
    entryPrice: fill.vwap,
    entryTs: call.ts,
    entryCandleTime: market.last.Time * 1000,
    atr,
    stop: fill.vwap - CFG.stopAtr * atr,
    exitAt: market.last.Time * 1000 + CFG.maxHoldBars * TF_MS,
    notional,
    feeBuy,
    cost: notional + feeBuy,
    spreadCost: fill.qty * Math.max(0, fill.vwap - mid),
    slipCost: 0,
    lastPrice: fill.vwap,
  };
  state.positions[u.pair] = pos;
  state.stats.orders++;
  const order = {
    ts: call.ts, pair: u.pair, side: 'buy', mode, reason,
    qty: fill.qty, price: fill.vwap, notional, fee: feeBuy,
    bestBid: market.bid, bestAsk: market.ask, signalPrice: market.last.Close,
    slippageBps: ((fill.vwap - market.last.Close) / market.last.Close) * 10000,
    spreadCost: pos.spreadCost, slipCost: 0,
  };
  await store.append('finn:orders', order);
  call.orders.push(order);
  call.actions.push(`beli ${u.pair} ${fill.qty} @ ${fill.vwap}`);
  return true;
}

async function doSell(market, pos, reason, state, store, call) {
  const u = market.u;
  if (!market.depthOk) return false;
  const fill = walkSell(market.depth, pos.qty);
  if (!(fill.qty > 0)) return false;
  const frac = fill.qty / pos.qty;
  const notional = fill.notional;
  const feeSell = notional * CFG.feeSell;
  state.cash += notional - feeSell;
  const costPart = pos.cost * frac;
  const netPnl = notional - feeSell - costPart;
  const mid = market.mid;
  const spreadCost = fill.qty * Math.max(0, mid - fill.vwap);
  const order = {
    ts: call.ts, pair: u.pair, side: 'sell', reason,
    qty: fill.qty, price: fill.vwap, notional, fee: feeSell,
    bestBid: market.bid, bestAsk: market.ask,
    signalPrice: market.last.Close,
    slippageBps: ((fill.vwap - market.last.Close) / market.last.Close) * 10000,
    entryPrice: pos.entryPrice, entryTs: pos.entryTs,
    entryNotional: pos.notional * frac, entryFee: pos.feeBuy * frac,
    entrySpreadCost: (pos.spreadCost || 0) * frac,
    entrySlipCost: 0,
    netPnl, ret: costPart > 0 ? netPnl / costPart : null,
    spreadCost, slipCost: 0, partial: fill.partial,
  };
  await store.append('finn:orders', order);
  call.orders.push(order);
  call.actions.push(`jual ${u.pair} ${fill.qty} @ ${fill.vwap} (${reason})`);

  if (fill.partial) {
    pos.qty -= fill.qty;
    pos.cost -= costPart;
    pos.notional -= pos.notional * frac;
    pos.feeBuy -= pos.feeBuy * frac;
    pos.lastPrice = fill.vwap;
  } else {
    delete state.positions[u.pair];
    state.cooldown[u.pair] = Date.now() + CFG.cooldownBars * TF_MS;
    state.stats.trades++;
    state.stats.fees += feeSell + pos.feeBuy;
  }
  return true;
}

export async function runTick({ source = 'vercel' } = {}) {
  const store = getStore();
  const started = Date.now();
  const call = {
    ts: new Date(started).toISOString(),
    source,
    actions: [],
    errors: [],
    skips: [],
    orders: [],
    processedCandles: [],
    pairsOk: [],
    pairsInvalid: [],
    latencyMs: 0,
  };
  const lock = await store.lock('finn:lock', 250);
  if (!lock) {
    return { ok: false, error: 'locked', ts: call.ts };
  }

  let state = null;
  try {
    const serverTime = await getServerTime();
    state = (await store.getState()) || initialState(CFG, serverTime);
    state.positions ||= {};
    state.pending ||= {};
    state.cooldown ||= {};
    state.lastCandle ||= {};
    state.stats ||= { orders: 0, trades: 0, fees: 0 };
    state.day ||= { date: wibDateKey(serverTime), startEquity: CFG.startEquity, blocked: false };

    const kill =
      String(process.env.KILL_SWITCH || '0') === '1' ||
      String((await store.getValue?.('finn:kill')) || '0') === '1';
    state.killSwitch = kill;
    if (kill) call.killSwitch = true;

    const market = await loadMarket(store, serverTime, call);
    const priceMap = new Map();
    for (const m of market) {
      if (m.depthOk) priceMap.set(m.u.pair, m.bid);
      if (m.candlesOk && m.depthOk && m.spreadBps <= CFG.maxSpreadBps) call.pairsOk.push(m.u.pair);
      else call.pairsInvalid.push(m.u.pair);
      if (m.candlesOk) state.lastCandle[m.u.pair] = m.last.Time;
    }

    state.equity = equityAt(state, priceMap);
    rollDay(state, state.equity, serverTime, CFG);
    if (state.day.blocked) call.dailyBlocked = true;

    // 1. Exit: waktu dulu, lalu stop. Kill switch tidak menghalangi exit.
    for (const [pair, pos] of Object.entries({ ...state.positions })) {
      const m = market.find((x) => x.u.pair === pair);
      if (!m) continue;
      if (m.candlesOk && m.last.Time * 1000 >= pos.exitAt) {
        await doSell(m, pos, 'waktu', state, store, call);
        continue;
      }
      if (m.depthOk && m.bid <= pos.stop) {
        await doSell(m, pos, 'stop', state, store, call);
      }
    }

    state.equity = equityAt(state, priceMap);
    rollDay(state, state.equity, serverTime, CFG);

    // 2. Pending limit: cek fill / batal. Kill switch & daily loss membatalkan order baru.
    for (const [pair, ord] of Object.entries({ ...state.pending })) {
      const m = market.find((x) => x.u.pair === pair);
      if (!m) continue;
      if (kill || state.day.blocked) {
        delete state.pending[pair];
        await logSkip(store, call, pair, kill ? 'kill_switch_cancel' : 'daily_loss_cancel');
        continue;
      }
      if (!m.candlesOk || !m.depthOk) continue;
      if (m.last.Time * 1000 >= ord.expiresAt || m.last.Close > ord.cSig * (1 + CFG.runaway)) {
        delete state.pending[pair];
        await logSkip(store, call, pair, m.last.Time * 1000 >= ord.expiresAt ? 'ttl' : 'runaway', { limit: ord.limit });
        continue;
      }
      if (m.ask <= ord.limit) {
        const ok = await doBuy(m, ord.atr, 'limit', 'limit_fill', state, store, call);
        if (ok) delete state.pending[pair];
      }
    }

    state.equity = equityAt(state, priceMap);

    // 3. Sinyal baru, hanya untuk candle tertutup yang belum pernah diproses.
    for (const m of market) {
      if (!m.candlesOk || !m.depthOk) continue;
      const t = m.last.Time;
      const key = `finn:seen:${m.u.pair}:${t}`;
      const fresh = await store.setNX(key, '1', 45 * 86400);
      if (!fresh) continue;
      call.processedCandles.push(t);

      if (m.spreadBps > CFG.maxSpreadBps) {
        await logSkip(store, call, m.u.pair, 'spread_lebar', { spreadBps: m.spreadBps });
        continue;
      }
      const block = entryBlockReason(state, m.u.pair, state.equity, CFG, kill);
      if (block) {
        await logSkip(store, call, m.u.pair, block);
        continue;
      }

      const ind = computeIndicators(m.closed, CFG);
      const sig = signalAt(ind, ind.n - 1, CFG, m.u.tick);
      if (!sig) continue;

      await store.append('finn:signals', {
        ts: call.ts, pair: m.u.pair, action: 'signal', mode: sig.mode,
        limit: sig.limit, atr: sig.atr, close: sig.close, candle: t,
        hhv: sig.hhv, ma: sig.ma, turnover: sig.turnover,
      });

      if (sig.mode === 'market') {
        const ok = await doBuy(m, sig.atr, 'breakout', 'breakout_market', state, store, call);
        if (!ok) await logSkip(store, call, m.u.pair, 'gagal_beli_market');
      } else {
        state.pending[m.u.pair] = {
          limit: sig.limit, atr: sig.atr, cSig: sig.close,
          signalBarTime: t, expiresAt: t * 1000 + CFG.ttlBars * TF_MS,
        };
        call.actions.push(`pending ${m.u.pair} limit ${sig.limit}`);
      }
    }

    // 4. Equity harian: panggilan pertama setelah 00.00 WIB.
    state.equity = equityAt(state, priceMap);
    const today = wibDateKey(serverTime);
    if (state.lastEquityDate !== today) {
      const rec = {
        date: today, ts: call.ts, equity: state.equity, cash: state.cash,
        positions: Object.keys(state.positions).length,
      };
      await store.append('finn:equity', rec);
      state.lastEquityDate = today;
      call.equity = rec;
    }

    state.lastTick = {
      ts: call.ts, equity: state.equity, pairsOk: call.pairsOk.length,
      pairsInvalid: call.pairsInvalid.length, orders: call.orders.length,
    };
    await store.setState(state);
  } catch (e) {
    call.errors.push('fatal: ' + e.message);
    if (state) {
      try {
        await store.setState(state);
      } catch {}
    }
    try {
      await store.append('finn:errors', { ts: call.ts, error: e.message, stack: e.stack });
    } catch {}
  } finally {
    call.latencyMs = Date.now() - started;
    try {
      await store.append('finn:calls', call);
    } catch {}
    await store.unlock('finn:lock');
  }

  return {
    ok: call.errors.filter((e) => !e.includes('spread')).length === 0,
    ts: call.ts,
    latencyMs: call.latencyMs,
    equity: state?.equity ?? null,
    cash: state?.cash ?? null,
    positions: state ? Object.keys(state.positions).length : null,
    pairsOk: call.pairsOk,
    pairsInvalid: call.pairsInvalid,
    orders: call.orders,
    processedCandles: call.processedCandles,
    warnings: call.errors,
    actions: call.actions,
  };
}
