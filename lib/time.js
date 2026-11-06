// Semua batas "hari" memakai WIB (UTC+7), bukan UTC.
export const TF_MS = 240 * 60 * 1000;
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function wibDateKey(ts = Date.now()) {
  return new Date(ts + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function wibStartOfDay(ts = Date.now()) {
  const d = new Date(ts + WIB_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - WIB_OFFSET_MS;
}

export function floorCandle(ts) {
  return Math.floor(ts / TF_MS) * TF_MS;
}

export function candleTimeMs(bar) {
  return bar.Time * 1000;
}

// Candle hanya boleh dipakai kalau sudah tertutup pada server_time.
export function isClosed(bar, serverTimeMs) {
  return candleTimeMs(bar) + TF_MS <= serverTimeMs;
}

export function closedCandles(bars, serverTimeMs) {
  return bars.filter((b) => isClosed(b, serverTimeMs));
}

export function iso(ts) {
  return new Date(ts).toISOString();
}

export function wibString(ts) {
  const d = new Date(ts + WIB_OFFSET_MS);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' WIB';
}

export function candleLabel(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
