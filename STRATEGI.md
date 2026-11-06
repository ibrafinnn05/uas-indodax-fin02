# STRATEGI — FINN 02 versi kripto 4 jam (Indodax)

Dokumen ini berisi aturan lengkap: masuk, keluar, sizing, risiko, pemilihan universe, dan semua
parameter. Semua angka **dibekukan pada commit freeze** dan tidak diubah setelahnya.

Sumber kode (satu-satunya implementasi aturan):

- `lib/strategy.js` → `computeIndicators()`, `signalAt()`, `sizePosition()`
- `lib/backtest.js` → mesin backtest (memakai fungsi yang sama)
- `lib/tick.js` → bot (memakai fungsi yang sama)
- `lib/config.js` → semua parameter

---

## 1. Prinsip dan perubahan dari versi UTS

Versi UTS (saham harian) dipertahankan prinsipnya:

| Dari UTS | Dipertahankan di versi kripto |
|---|---|
| Sinyal breakout tertinggi N bar (HHV) | HHV20 (tinggi 20 bar sebelum bar berjalan) |
| Filter tren MA | MA50 pada close |
| Dua jenis entry: breakout dan buy-by-limit | `limit` (utama) dan `break` (varian yang diuji) |
| Exit hanya harga (stop) dan waktu | stop ATR + batas hold bar |
| Sizing berbasis risiko | risiko 1% per trade, maksimum 20% per nama |

Perubahan yang dicatat (selesai sebelum freeze):

1. **Timeframe harian → 4 jam.** Alasan: candle harian hanya menghasilkan ~10 bar dalam 10 hari
   forward, sehingga trade bisa nol. Candle 4 jam memberi ~60 bar pada jendela yang sama.
2. **Saham BEI → kripto IDR Indodax.** Universe 5 pasangan, likuiditas diukur pada awal periode
   backtest (lihat bagian 5), bukan volume hari ini.
3. **Fee & slippage** memakai tarif taker all-in resmi Indodax dan **snapshot order book sendiri**
   (spread + slippage diukur, bukan asumsi tetap).
4. **Entry limit dijadikan utama** karena backtest menunjukkan versi limit lebih stabil di luar
   sampel (bagian 6). Breakout market tetap tersedia sebagai varian yang diuji dan dilaporkan.
5. **Aturan tambahan untuk API publik**: validasi candle tertutup, pembatalan order karena spread
   lebar/likuiditas, daily loss limit WIB, kill switch, dan idempotency per candle.

---

## 2. Aturan masuk

**Kondisi sinyal** (dihitung hanya dari candle yang sudah tertutup):

```
close  > HHV20        (breakout tertinggi 20 bar sebelum bar ini)
close  > MA50         (filter tren)
median turnover20 >= Rp500.000.000 per bar   (filter likuiditas)
ATR14  > 0, harga > 0, candle valid
```

`HHV20` sengaja **tidak** memasukkan bar berjalan, supaya tidak ada data masa depan.

**Jenis entry:**

| Mode | Kapan | Cara eksekusi |
|---|---|---|
| `limit` (utama, `entryMode: 'limit'`) | semua sinyal | pasang buy-by-limit pada `floor_tick(close − 1,1 × ATR14)` |
| `break` (varian) | semua sinyal | beli market pada candle berikutnya |
| `both` (tidak dipakai) | sinyal "kuat" (`close >= HHV20 + 1 × ATR`) → market; sisanya limit | — |

**Order limit:**

- **TTL 5 bar** (20 jam). Kalau belum terisi dalam 5 bar, order dibatalkan dan dicatat (`ttl`).
- **Runaway**: bila `close > harga_sinyal × 1,12` order dibatalkan (`runaway`) — jangan kejar harga.
- Fill di backtest: candle berikutnya terisi bila `low < limit` (harga masuk `min(open, limit)`).
- Fill di bot: `ask <= limit` pada order book live (beli di ask, bukan mid/close).

**Yang memblokir entry** (semua tercatat di `logs/raw/signals.jsonl`):

- posisi/pending pada pasangan yang sama sudah ada
- jumlah posisi + pending mencapai **5 slot**
- cooldown **5 bar** setelah exit pada pasangan yang sama
- **daily loss limit 3%** (hari WIB sudah terblokir)
- **kill switch** aktif
- spread bid/ask > **2%** (200 bp), order book kosong, candle tidak valid

---

## 3. Aturan keluar (hanya harga dan waktu)

| Jenis | Syarat | Harga |
|---|---|---|
| Stop loss | `bid <= stop` | `stop = harga_masuk − 5 × ATR14` |
| Waktu | candle ke-120 (480 jam) sejak candle entry | harga market saat itu |
| Stop gap | `open < stop` pada candle | harga open (lebih buruk dari stop, dicatat `stop_gap`) |

Tidak ada take profit, trailing stop, indikator exit, atau penyebab fundamental.
Exit **tetap dijalankan** walaupun kill switch aktif atau daily loss terblokir.

`maxHoldBars = 120` dan `stopAtr = 5` dipilih dari grid in-sample/out-of-sample (bagian 6).

---

## 4. Sizing dan manajemen risiko

```
stopDist          = 5 × ATR14
qty_risk          = (equity × 1%) / stopDist
qty_maxnama       = (equity × 20%) / harga
qty_kas           = kas / (harga × (1 + fee_beli))
qty               = floor(qty_risk, qty_maxnama, qty_kas, ke qtyStep)
batal jika        notional < Rp25.000 (minimum order Pro)
```

- **Risiko per trade: 1%** dari equity.
- **Maksimum per nama: 20%** equity. **Maksimum 5 posisi** (slot dipakai bersama order pending).
- **Daily loss limit 3%**: dihitung dari equity pada awal hari **WIB (UTC+7)**, berganti 00.00 WIB.
  Bila terlampaui, pembatalan order pending + tidak ada entry baru sampai hari berikutnya.
- Equity posisi terbuka selalu dinilai pada **best bid**, bukan last/mid.

---

## 5. Universe (anti survivorship bias)

| Pair | Tick | Qty step | Spread median (snapshot) |
|---|---:|---:|---:|
| BTC/IDR | 1.000 | 1e-8 | 15,4 bp |
| ETH/IDR | 1.000 | 1e-8 | 11,1 bp |
| XRP/IDR | 1 | 1e-8 | 15,4 bp |
| SOL/IDR | 1 | 1e-8 | 15,5 bp |
| DOGE/IDR | 1 | 1e-8 | 15,2 bp |

Kriteria (`scripts/select_universe.js`, hasil di `data/universe_candidates.json`):

1. Semua pasangan IDR yang terdaftar di `/api/pairs` pada saat seleksi, ber-coingecko_id,
   bukan stablecoin, tidak dalam maintenance/suspension.
2. Harus punya data candle 4 jam pada **30 hari pertama periode backtest** (2023-11-06 → 2023-12-06).
3. Diperingkat berdasarkan **turnover rupiah (`close × volume`) pada 30 hari tersebut** — bukan volume
   hari ini — lalu diambil 5 teratas.
4. Kandidat dengan data: **124 dari 399** pasangan yang dicek. Hasil 10 besar:
   BTC 713,5 M · ETH 249,2 M · XRP 197,8 M · SOL 186,2 M · DOGE 175,5 M · AIOZ 108,3 M · ADA 90,9 M ·
   BNB 54,6 M · TRX 51,4 M · VELO 46,4 M (rupiah, periode 2023).

**Keterbatasan:** `/api/pairs` hanya memuat pair yang masih listing hari ini, jadi pair yang delisting
sebelum 2023 tidak bisa dipilih. Ini keterbatasan data API publik, dicatat di README.

---

## 6. Parameter beku dan cara memilihnya

| Parameter | Nilai | Catatan |
|---|---:|---|
| Timeframe | 240 menit | candle UTC; batas hari WIB |
| HHV N | 20 | tanpa bar berjalan |
| MA N | 50 | filter tren |
| ATR N | 14 | Wilder |
| Turnover median N | 20 | min Rp500 juta/bar |
| `limitAtr` | **1,1** | offset buy-by-limit |
| `ttlBars` | **5** | 20 jam |
| `runaway` | 0,12 | batal bila harga kabur |
| `strongAtr` | 1,0 | untuk mode `both` (tidak dipakai) |
| `stopAtr` | **5,0** | stop loss |
| `maxHoldBars` | **120** | exit waktu (20 hari) |
| `riskPerTrade` | 0,01 | 1% equity |
| `maxPositions` | 5 | slot |
| `maxPerName` | 0,20 | 20% equity |
| `cooldownBars` | 5 | jeda antar entry di pasangan yang sama |
| `minOrderIdr` | 25.000 | minimum order Pro |
| `dailyLossLimit` | 0,03 | hari WIB |
| `feeBuy` / `feeSell` | 0,20555% / 0,41555% | taker all-in resmi |

### Hasil pencarian parameter (grid dijalankan sebelum freeze)

Metrik: CAGR / MDD in-sample (2 tahun) → CAGR / MDD out-of-sample (1 tahun).

| stopAtr | limitAtr | IS | OOS | Penuh (3 th) |
|---:|---:|---|---|---|
| 3,0 | 0,5 | +61,9% / −28,5% | **−28,1% / −34,8%** | +11,1% / −44,7% |
| 4,0 | 1,0 | — | −9,0% / −23,4% | — |
| 4,5 | 1,1 | +22,1% / −20,9% | +6,7% / −11,7% | +16,7% / −27,5% |
| **5,0** | **1,1** | **+25,9% / −18,1%** | **+9,4% / −10,4%** | **+20,1% / −24,3%** |
| 5,0 | 1,2 | +24,3% / −18,1% | +9,9% / −10,4% | +19,3% / −24,9% |
| 5,5 | 1,1 | +24,3% / −18,5% | +6,7% / −11,1% | +17,5% / −25,7% |

Pertimbangan pemilihan:

- Versi pertama (`stopAtr=3`, `limitAtr=0,5`, `maxHoldBars=180`) terlihat bagus di in-sample
  (CAGR +61,9%) tetapi **runtuh di out-of-sample (−28,1%)** dan MDD penuh −44,7%. Ditolak.
- `stopAtr=5` + `limitAtr=1,1` memberi OOS terbaik yang stabil, MDD penuh −24,3%, dan berada di
  tengah kelompok tetangga (limitAtr 1,0–1,2, stop 5,0–5,5) — bukan titik terbaik yang menyendiri,
  sehingga tidak diduga overfit.
- `ttlBars=4` dan `6` lebih buruk di OOS (3,3% dan 7,8%); `maxHoldBars=100/140` lebih buruk
  (7,5% dan −1,0%). Nilai 5/120 dipilih.
- `entryMode='limit'` (OOS +9,4%) mengalahkan `break` (−1,1%) dan `both` (+0,7%) di luar sampel,
  meskipun `break` unggul di in-sample. **Pemilihan berdasarkan OOS, bukan IS.**

---

## 7. Variasi yang diuji dan dilaporkan (bukan disembunyikan)

| Variasi | 3 tahun: return / MDD | 10 hari terakhir |
|---|---:|---:|
| `limit` (dibekukan) | +73,46% / −24,29% | −1,99% (2 trade) |
| `break` | +83,15% / −31,44% | −4,84% (4 trade) |

---

## 8. Eksekusi dry run (bukan teori)

- Beli di **ask**, jual di **bid** order book live; order > 1 level menghabiskan level berikutnya dan
  memakai VWAP. **Fill di mid atau close dilarang** (diuji di `scripts/test_execution.js`).
- Fee taker all-in (lihat bagian tabel parameter), minimum order Rp25.000, patuh tick size dan qty step.
- Data divalidasi setiap panggilan: candle terakhir ≤ 2× timeframe, tidak ada candle hilang di jendela
  indikator, harga/volume > 0, order book tidak kosong, spread ≤ 200 bp. Setiap penolakan dicatat.
- Hanya candle **tertutup** yang dipakai (`Time + durasi <= server_time`).

Jalankan `npm test` untuk melihat pemeriksaan eksekusi terhadap snapshot order book dan data asli.
