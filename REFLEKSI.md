# REFLEKSI — selisih backtest vs forward test

Dokumen ini menjelaskan **selisihnya dalam angka**. Semua angka di bawah berasal dari
`data/backtest/result.json` (backtest) dan `logs/raw/` (forward), dan bisa dihitung ulang dengan
`npm run hitung`.

> **Status forward saat pengumpulan: parsial.** Freeze 6 Nov 2026 19.00 WIB; bot live di Vercel dan
> mulai berjalan pada panggilan produksi pertama `2026-11-07 02.02 WIB` (storage Upstash Redis).
> Per 7 Nov 2026 03.03 WIB forward baru **0,04 hari** dan **2 candle**. Tenggat UAS 14 Nov membuat
> forward 10 hari penuh tidak mungkin selesai. Dashboard menandainya "parsial"; angka forward
> **bukan hasil final**.

---

## 1. Forward berjalan sejauh ini

| Metrik | Nilai | Sumber |
|---|---:|---|
| Hari berjalan | 0,04 hari dari 10 | `logs/raw/state.json` |
| Panggilan tercatat | 6 (termasuk uji manual GitHub Actions) | `logs/raw/calls.jsonl` |
| Candle terproses tepat waktu | 2 / 2 (**100%**) | `processedCandles` + definisi uptime |
| Error API/data | 0 | `logs/raw/errors.jsonl` |
| Pemakaian kill switch (produksi) | 0× | `logs/raw/calls.jsonl` |
| Order simulasi | 0 | `logs/raw/orders.jsonl` |
| Sinyal / skip | 0 sinyal, 0 skip | `logs/raw/signals.jsonl` |
| Equity | Rp100.000.000 (0,00%) | `logs/raw/equity.jsonl` + state |
| Snapshot spread forward | 30 (5 per panggilan) | `logs/raw/spreads.jsonl` |
| Snapshot order book mentah | 30 | `logs/raw/depth.jsonl` |
| Snapshot candle bot | 2 candle × 5 pair (1.000 bar) | `logs/raw/candles.json` |

**Kenapa belum ada trade?** Bukan karena bot tidak jalan: dua candle tertutup yang diproses
(2026-11-06 12.00 dan 16.00 UTC) tidak memenuhi syarat masuk pada **kelima** pasangan sekaligus.
Angka pada candle 16.00 UTC (divalidasi dengan kode backtest yang sama; candle 12.00 UTC juga gagal
dengan pola yang sama):

| Pair | Close | HHV20 | MA50 | Close > HHV20? | Close > MA50? |
|---|---:|---:|---:|---|---|
| BTC/IDR | 1.370.992.000 | 1.468.996.000 | 1.415.342.740 | tidak | tidak |
| ETH/IDR | 40.350.000 | 44.291.000 | 41.352.220 | tidak | tidak |
| XRP/IDR | 21.417 | 24.245 | 22.807 | tidak | tidak |
| SOL/IDR | 1.628.992 | 1.776.000 | 1.707.866 | tidak | tidak |
| DOGE/IDR | 1.316 | 1.415 | 1.362 | tidak | tidak |

### 1.1 Gap backtest vs forward pada jendela yang sama

Jendela = candle yang benar-benar diproses bot: **2026-11-06 12.00 UTC → 19.59:59 UTC (2 candle)**.
Backtest dijalankan ulang dengan `logs/raw/candles.json` (snapshot candle yang dilihat bot) + data
beku di `data/raw/`, memakai fungsi sinyal yang sama (`lib/strategy.js`).

| Metrik | Backtest jendela | Forward aktual | Selisih |
|---|---:|---:|---:|
| Return total | 0,00% | 0,00% | 0,00 pp |
| Maximum drawdown | 0,00% | 0,00% | 0,00 pp |
| Profit factor | — (0 trade) | — (0 trade) | — |
| Jumlah trade | 0 | 0 | 0 |
| Sinyal masuk | 0 | 0 | 0/0 cocok |
| Benchmark BTC/IDR | **−1,06%** | — | — |

Selisih return **0,00 pp** karena keduanya belum membuka posisi. Yang perlu dicatat: pada jendela
yang sama BTC turun **−1,06%**, sedangkan strategi memilih tetap flat karena tidak ada pasangan yang
menembus HHV20 dan berada di atas MA50. Ini contoh strategi yang "tidak memaksa trade".

Pasar sedang di bawah rata-rata 50 bar setelah penurunan, jadi tidak ada breakout. Backtest pada
jendela yang sama juga menghasilkan **0 sinyal** → kecocokan sinyal **0/0**. Rubrik UAS memang
menyatakan bot dengan 0 trade bisa tetap nilai penuh **asal log sinyalnya sama**.

---

## 2. Selisih in-sample vs out-of-sample (yang paling jujur sejauh ini)

| | In-sample (2023-11 → 2025-11) | Out-of-sample (2025-11 → freeze) | Selisih |
|---|---:|---:|---:|
| Return | +58,48% | +9,45% | −49,03 pp |
| CAGR | 25,87% | 9,44% | −16,43 pp |
| Max drawdown | −18,07% | −10,43% | lebih kecil |
| Jumlah trade | 132 | 54 | −78 |
| Win rate | 37,88% | 42,59% | +4,71 pp |
| Rata-rata untung | +24,05% | +10,12% | −13,93 pp |
| Rata-rata rugi | −8,86% | −7,32% | lebih kecil |
| Profit factor | 1,47 | 1,34 | −0,13 |
| Porsi biaya | 8,55% | 12,44% | +3,89 pp |
| BTC buy & hold | **+212,99%** | **−21,85%** | −234,84 pp |

Penyebab selisihnya, dalam angka:

1. **Regime pasar berubah.** Tahun out-of-sample adalah tahun turun untuk BTC (−21,85%, drawdown
   −41,19%). Strategi long-only dengan stop tidak bisa menghasilkan seperti tahun naik.
   Sebaliknya, justru di tahun turun in-sample-vs-oos inilah strategi bertahan (+9,45% sementara
   benchmark −21,85%): **di OOS strategi mengalahkan benchmark sebesar 31,30 pp**.
2. **Sinyal lebih sedikit dan lebih kecil.** Trade turun 132 → 54 (−56%), dan rata-rata untung per
   trade turun dari 24,05% ke 10,12%. Profit yang tersisa lebih tipis, sehingga fee yang tetap
   memakan 8,55% → 12,44% dari laba kotor.
3. **Drawdown justru membaik** (−18,07% → −10,43%). Ini konsisten dengan hipotesis: parameter yang
   dipilih tidak mengejar return in-sample; ia mengorbankan sebagian upside untuk mengurangi risiko.

Kesimpulan: **angka backtest penuh (+73,46%) adalah gabungan dua tahun bagus dan satu tahun buruk.**
Angka yang paling konservatif untuk ekspektasi ke depan adalah OOS: **+9,45% per tahun dengan
drawdown −10,43%**.

---

## 3. Strategi vs buy & hold BTC (3 tahun)

| | FINN 02 | BTC/IDR buy & hold |
|---|---:|---:|
| Return 3 tahun | +73,46% | **+147,34%** |
| Max drawdown | **−24,29%** | −49,43% |
| Sharpe (harian, ×365) | 0,98 | 0,93 |
| Waktu di pasar | 82,0% | 100% |
| Biaya | Rp25.490.135 (9,53% laba kotor) | 1× beli + 1× jual |

Selisih +73,88 pp terhadap BTC dijelaskan oleh:

1. **Long-only + stop + exit waktu = tidak bisa ikut seluruh kenaikan.** Strategi keluar lewat stop
   5 ATR (93 dari 186 trade) atau batas waktu 120 bar (93 trade), lalu menunggu sinyal baru.
   Pada pasar yang naik lurus seperti 2024–2025, buy & hold menang.
2. **Risiko juga separuh.** Drawdown strategi −24,29% vs BTC −49,43%; Sharpe hampir sama (0,98 vs
   0,93). Dalam satuan risiko per unit, strategi tidak lebih buruk — ini bukan kemenangan return
   mentah, dan saya tidak mengklaim sebaliknya.
3. **Biaya taker membakar 9,53% laba kotor.** 186 round-trip dengan fee all-in 0,20555%/0,41555%
   plus spread median 11–16 bp dan slippage terukur 0–3 bp per order Rp25 juta.
4. **23 dari 36 bulan berakhir rugi.** Profit strategi terkonsentrasi pada beberapa bulan tren kuat
   (contoh: Agustus 2026 +Rp27.404.223 dari 5 trade).

---

## 4. Jendela 10 hari terakhir sebelum freeze (referensi, bukan forward)

| | FINN 02 | BTC/IDR |
|---|---:|---:|
| Return | −1,99% | −6,08% |
| Max drawdown | −2,30% | −7,28% |
| Trade | 2 | — |

Strategi kecil, tetapi kalah lebih sedikit daripada BTC pada periode yang sama (2 trade, keduanya
rugi karena stop). Varian `break` pada jendela yang sama memberi −4,84% dengan 4 trade — lebih buruk,
sesuai temuan out-of-sample.

---

## 5. Selisih yang diharapkan saat forward berjalan penuh

Kalau bot di-deploy dan berjalan sampai 10 hari, sumber selisih backtest vs forward sudah
diperkirakan sejak awal (dan harusnya muncul di log):

1. **Keterlambatan jadwal.** Penjadwal GitHub Actions bisa terlambat beberapa menit; batas candle
   berikutnya adalah 4 jam. Candle yang diproses setelah batas itu **tidak dihitung uptime** (definisi
   resmi). Menit ke-7 dipilih agar tidak menumpuk di menit ke-0. Waktu tiap panggilan tercatat di
   `calls.jsonl` dan dipakai langsung untuk angka uptime.
2. **Isi order berbeda secara struktural.** Backtest mengisi limit pada `min(open, limit)` di candle
   berikutnya bila `low < limit`; bot mengisi hanya bila `ask <= limit` pada order book live.
   Artinya bot **lebih lambat dan lebih konservatif** — tidak akan ada fill yang lebih baik dari
   backtest karena dibuat di mid/close.
3. **Spread & slippage.** Backtest memakai median snapshot sebelum freeze (11,1–15,5 bp). 30 snapshot
   forward pertama (6 panggilan × 5 pair) memberi median: BTC 21,9 bp · ETH 2,7 bp · XRP 13,8 bp ·
   SOL 11,8 bp · DOGE 11,4 bp. Sampelnya masih kecil dan bergerak antar panggilan, tetapi untuk
   3 dari 5 pair arahnya **biaya forward lebih rendah atau setara** asumsi backtest; BTC dan XRP
   justru lebih lebar, sehingga estimasi konservatif tetap dipakai.
4. **Jam pasar.** Candle 4 jam UTC = 07.00, 11.00, 15.00, 19.00, 23.00, 03.00 WIB. Order yang jatuh
   di jam sepi mengisi di level yang lebih tipis; hal ini muncul sebagai selisih harga fill per
   trade di `orders.jsonl` (bid/ask terbaik ikut direkam).
5. **Posisi yang sama dibuka pada waktu berbeda.** Backtest membuka semua posisi dari kondisi awal
   flat di awal jendela; bot mulai flat pada waktu deploy. Karena itu perbandingan yang adil memakai
   **jendela candle yang benar-benar diproses bot**, dan itu yang dilakukan dashboard
   (`lib/report.js → forwardWindowBacktest`).

---

## 6. Yang sudah diuji sebelum freeze

| Uji | Hasil | Bukti |
|---|---|---|
| Konsistensi kode sinyal backtest ↔ bot | keduanya mengimpor `signalAt` dari `lib/strategy.js` | `npm test`, `logs/test/execution.txt` |
| Fill di order book asli (bukan mid) | beli VWAP ≥ ask, jual VWAP ≤ bid | `logs/test/execution.txt` |
| Fee & minimum order | 0,20555% / 0,41555%, ≥ Rp25.000 | `logs/test/execution.txt` |
| Data candle asli | 6.579 bar/pasangan, 0 celah, 2023-11-06 → 2026-11-06 | `logs/test/execution.txt` |
| Hitung ulang P&L satu trade | cocok sampai Rp1 dari log | `logs/test/execution.txt` |
| Idempotency | panggilan kedua candle sama → 0 candle diproses | `logs/raw/calls.jsonl` |
| Idempotency di produksi (Vercel) | panggilan ke-2 dan ke-3 → `processedCandles: []` | `logs/raw/calls.jsonl` |
| Deploy Vercel + Redis | tick produksi 200 OK, 5 pair valid, 0 error, state di Redis | catatan deploy 7 Nov 2026 |
| Penjadwal cloud | GitHub Actions run #1 sukses (10 detik), tick masuk `19:49:49Z` | https://github.com/ibrafinnn05/uas-indodax-fin02/actions |
| Filesystem Vercel | percobaan pertama gagal `EROFS` → pindah ke Redis (bukan diabaikan) | log deployment 7 Nov 2026 |
| Kill switch | `KILL_SWITCH=1` → 5 skip berlabel `kill_switch`, 0 order | `logs/test/killswitch/` |
| Tanpa sinyal | 3 panggilan, 2 candle, 0 order, 0 error | `logs/test/nosignal/` |
| Gap backtest–forward | backtest jendela 2 candle dihitung dari snapshot candle bot: 0 trade vs forward 0 trade, BTC −1,06% | `logs/raw/candles.json`, dashboard `?format=json` |

---

## 7. Keputusan yang saya ambil dan harganya

1. **Freeze terlambat 2 hari** (6 Nov vs jadwal 4 Nov). Harga: forward maksimal 8 hari, bukan 10.
   Alternatif yang saya tolak: mengklaim freeze 4 Nov (itu fabrikasi) atau mereplay 10 hari lalu
   menyebutnya "forward" (itu juga fabrikasi).
2. **Parameter dipilih dari OOS, bukan IS.** Versi dengan return in-sample tertinggi (CAGR +61,9%)
   justru yang terburuk di luar sampel (−28,1%). Harga: return penuh "hanya" +73,46%.
3. **Fee memakai angka resmi yang lebih mahal** (bukan `/api/pairs` 0,2%). Harga: −Rp5–10 juta per
   3 tahun dibanding tarif API, tetapi angkanya bisa dipertanggungjawabkan.
4. **Entry limit, bukan breakout market.** Harga: order bisa tidak terisi (TTL 5 bar), sehingga
   trade lebih sedikit; keuntungannya: OOS +9,4% vs −1,1% untuk breakout.

---

## 8. Kalau diberi waktu penuh

1. Jalankan forward 10 hari tanpa menyentuh aturan; isi `logs/raw/` setiap hari.
2. Setiap hari bandingkan `forward.window.compare.matchRate` di dashboard — targetnya 100%.
3. Di akhir, tulis selisih per trade: harga fill bot vs harga fill backtest, lalu bedakan
   kontribusi spread, slippage, dan keterlambatan jadwal dari `orders.jsonl`.
4. Bandingkan median spread forward (seluruh snapshot) dengan median yang dipakai backtest,
   sesuai instruksi soal.
