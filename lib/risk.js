import { wibDateKey } from './time.js';

export function initialState(cfg, now = Date.now()) {
  return {
    version: 1,
    startedAt: new Date(now).toISOString(),
    cash: cfg.startEquity,
    equity: cfg.startEquity,
    positions: {},
    pending: {},
    cooldown: {},
    day: { date: wibDateKey(now), startEquity: cfg.startEquity, blocked: false },
    killSwitch: false,
    lastTick: null,
    lastCandle: {},
    stats: { orders: 0, trades: 0, fees: 0 },
  };
}

export function rollDay(state, equity, now, cfg) {
  const d = wibDateKey(now);
  if (!state.day || state.day.date !== d) {
    state.day = { date: d, startEquity: equity, blocked: false };
  }
  if (equity < state.day.startEquity * (1 - cfg.dailyLossLimit)) {
    state.day.blocked = true;
  }
  return state.day;
}

export function entryBlockReason(state, pair, equity, cfg, killSwitch) {
  if (killSwitch) return 'kill_switch';
  if (state.day?.blocked) return 'daily_loss_limit';
  if (state.positions[pair]) return 'sudah_posisi';
  if (state.pending[pair]) return 'sudah_pending';
  if (Object.keys(state.positions).length >= cfg.maxPositions) return 'slot_penuh';
  if (Object.keys(state.pending).length + Object.keys(state.positions).length >= cfg.maxPositions) return 'slot_penuh';
  const cd = state.cooldown?.[pair];
  if (cd && cd > Date.now()) return 'cooldown';
  if (!(equity > 0)) return 'equity_tidak_valid';
  return null;
}
