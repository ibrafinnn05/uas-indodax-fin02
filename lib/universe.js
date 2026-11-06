// Universe beku. Ditulis oleh scripts/select_universe.js.
// Kriteria: semua pair IDR yang terdaftar di API publik pada +058818-10-25T13:01:01.000Z,
// diperingkat memakai turnover rupiah pada 30 hari PERTAMA periode backtest
// (2023-11-06 s/d 2023-12-06), bukan volume hari ini.
// Pair tanpa data pada awal periode dikeluarkan. Pair yang sudah delisting
// tidak tersedia di API publik -> keterbatasan data yang dicatat di README.
export const UNIVERSE = [
  { pair: 'btc_idr', symbol: 'BTCIDR', id: 'btcidr', tick: 1000, qtyStep: 1e-8 },
  { pair: 'eth_idr', symbol: 'ETHIDR', id: 'ethidr', tick: 1000, qtyStep: 1e-8 },
  { pair: 'xrp_idr', symbol: 'XRPIDR', id: 'xrpidr', tick: 1, qtyStep: 1e-8 },
  { pair: 'sol_idr', symbol: 'SOLIDR', id: 'solidr', tick: 1, qtyStep: 1e-8 },
  { pair: 'doge_idr', symbol: 'DOGEIDR', id: 'dogeidr', tick: 1, qtyStep: 1e-8 },
];

export const UNIVERSE_META = {
  "selectedAt": "2026-11-06T14:35:48.066Z",
  "method": "Semua pair IDR ber-coingecko_id yang terdaftar di API publik; diperingkat dari turnover (close x volume) 30 hari pertama backtest 2023-11-06 s/d 2023-12-06. Bukan volume hari ini.",
  "periodStart": "2023-11-06T00:00:00Z",
  "candidatesWithData": 124,
  "candidatesChecked": 399,
  "note": "API publik hanya memuat pair yang masih ada hari ini. Pair yang delisting sebelum freeze tidak bisa dipilih; ini keterbatasan data, bukan aturan."
};
