# FINN 02 · Bot Dry Run Indodax di Vercel

UAS Algoritma Trading (Trad1 & Trad2). Strategi **FINN 02** dari UTS diadaptasi ke pasar kripto IDR
Indodax dengan **timeframe 4 jam**, **long-only**, dan **tanpa API key**. Bot membaca candle dan order
book sungguhan, menghitung sinyal dengan **fungsi yang sama dengan backtest**, lalu mengeksekusi
**order simulasi di harga bid/ask**.

> **Status jujur (baca dulu).**
> - **Bot sudah live** di https://uas-indodax-fin02.vercel.app (dashboard `/dashboard`, status `/status`)
>   dengan storage Upstash Redis dan pemicu otomatis tiap 4 jam.
> - Freeze dilakukan **6 November 2026, 19.00 WIB**, melewati jadwal UAS 4 November 2026 12.00 WIB.
>   Alasan: persiapan berjalan di luar jadwal. Keterlambatan ini dicatat, bukan disembunyikan.
> - Karena tenggat 14 November, **forward test 10 hari penuh tidak mungkin selesai**. Forward baru
>   berjalan sejak 7 November 2026 02.02 WIB; angka forward pada dashboard adalah **hasil sementara**
>   dan ditandai "parsial".
> - Yang paling kuat tersedia sebelum forward lengkap adalah **backtest out-of-sample** (1 tahun terakhir
>   yang tidak dipakai saat memilih parameter).
> - Tidak ada angka forward yang ditulis tangan. Semua dihitung ulang dari `logs/raw/` (hasil ekspor Redis).

---

## 1. Ringkasan hasil

Modal virtual Rp100.000.000. Candle 4 jam Indodax, 2023-11-06 → 2026-11-06 (freeze).

| Periode | Return | CAGR | Max drawdown | PF | Trade | BTC buy & hold |
|---|---:|---:|---:|---:|---:|---:|
| Backtest penuh (3 tahun) | **+73,46%** | +20,14% | −24,29% | 1,44 | 186 | +147,34% (MDD −49,43%) |
| In-sample 2023-11 → 2025-11 | +58,48% | +25,87% | −18,07% | 1,47 | 132 | +212,99% |
| Out-of-sample 2025-11 → freeze | **+9,45%** | +9,44% | −10,43% | 1,34 | 54 | −21,85% (MDD −41,19%) |
| 10 hari terakhir sebelum freeze | −1,99% | — | −2,30% | — | 2 | −6,08% |
| Forward (berjalan, parsial) | 0,00% | — | 0,00% | — | 0 | 7,89 hari · 48 candle; lihat dashboard |

- Biaya total backtest Rp25.490.135 = **9,53% dari laba kotor** (fee + spread + slippage).
- Sinyal masuk: **limit buy** pada `close − 1,1 ATR`; exit hanya **stop (5 ATR)** atau **waktu (120 bar)**.
- Angka lengkap ada di `data/backtest/result.json` dan dashboard `public/index.html`.

**Catatan penting:** di periode penuh, buy & hold BTC mengalahkan strategi. Strategi ini menang pada
out-of-sample (BTC −21,85% vs strategi +9,45%) dan pada jendela 10 hari terakhir. Penjelasannya ada di
[REFLEKSI.md](REFLEKSI.md).

---

## 2. Struktur repository

```
lib/                  mesin bersama (backtest dan bot memakai kode yang sama)
  strategy.js         indikator, signalAt(), sizing() — satu-satunya logika sinyal
  backtest.js         mesin backtest (fill di open/low, stop, waktu, daily loss)
  tick.js             orkestrasi bot: validasi data → exit → pending → sinyal → log
  report.js           model angka untuk dashboard (dihitung dari log mentah)
  render.js           HTML dashboard (offline mandiri, tanpa CDN)
  indodax.js          klien API publik + retry terbatas + validasi candle
  broker.js           walk order book (beli di ask, jual di bid), fee
  store.js            Upstash Redis (produksi) / JSON lokal (pengembangan)
  risk.js, metrics.js risiko harian, kill switch, uptime, drawdown
api/
  tick.js             endpoint dipanggil penjadwal (dilindungi CRON_SECRET)
  dashboard.js        halaman live yang membaca log dari storage
  status.js           status operasional JSON
public/index.html     dashboard offline mandiri (hasil npm run dashboard)
scripts/              perintah lokal: data, backtest, tick, ekspor, hitung ulang, uji, ZIP
data/raw/             candle mentah Indodax 3 tahun (CSV + JSON)
data/depth/           snapshot order book (mentah + median)
data/backtest/        hasil backtest
data/freeze.json      catatan freeze
logs/raw/             LOG MENTAH forward (calls, orders, signals, equity, errors, spreads, depth)
logs/test/            hasil uji (eksekusi, kill switch, alur tanpa sinyal)
.github/workflows/    penjadwal GitHub Actions (cron 4 jam, menit ke-7 UTC)
```

Tidak ada dependensi eksternal: cukup Node.js ≥ 20.

---

## 3. Menjalankan lokal

```bash
# 1. (sekali) pilih universe & tarik data — butuh internet, jangan diulang tanpa perlu
npm run universe      # menulis lib/universe.js dari turnover 30 hari pertama backtest
npm run fetch         # menarik mundur candle 4 jam 3 tahun → data/raw/
npm run depth         # snapshot order book → data/depth/  (minimal 3× sehari selama pengumpulan)

# 2. backtest dan uji
npm run backtest      # → data/backtest/result.json + trades.csv + equity.csv
npm test              # 24 pemeriksaan: fee, fill, sizing, konsistensi kode, data asli

# 3. bot dry run lokal (memakai API publik Indodax, tanpa API key)
cp .env.example .env  # isi CRON_SECRET
npm run tick          # satu panggilan bot + ekspor log → logs/raw/
npm run export        # ekspor ulang log dari storage ke logs/raw/

# 4. hitung ulang & dashboard
npm run hitung        # hitung ulang SEMUA angka dari data mentah → public/index.html
npm run dashboard     # render ulang HTML dari data/recompute.json (cepat)

# 5. paket ZIP pengumpulan (harus sudah git init + commit)
npm run zip           # dist/uas-indodax-submit.zip (termasuk folder .git)
```

`npm run hitung` adalah **skrip hitung ulang**: ia membaca `data/raw/*_240.csv` dan `logs/raw/*.jsonl`,
menjalankan backtest ulang, menghitung ulang metrik forward, lalu menulis ulang dashboard. Tidak ada
angka performa yang dibaca dari dashboard lama.

---

## 4. Deploy ke Vercel

### 4.1 Buat repositori (bukti freeze)

```bash
git init
git add -A
git commit -m "freeze: aturan, parameter, universe, backtest 3 tahun (6 Nov 2026)"
git remote add origin https://github.com/<nama>/uas-indodax.git
git push -u origin main
```

Bukti freeze = **commit ini**. Jangan force-push atau menulis ulang riwayat setelahnya.
Hash dan waktunya tercatat di bagian 7 di bawah.

### 4.2 Storage (wajib)

Filesystem Vercel **read-only** (percobaan pertama bot gagal dengan `EROFS: read-only file system`),
jadi state/log disimpan di **Upstash Redis**:

1. Vercel → project → **Storage** → marketplace **Upstash for Redis** (paket gratis) → create.
   Bisa juga dari CLI: `vercel integration add upstash/upstash-kv` (perlu menerima terms di browser sekali).
2. Marketplace menulis variabel **`KV_REST_API_URL`** dan **`KV_REST_API_TOKEN`**.
   `lib/store.js` menerima keduanya maupun nama asli Upstash (`UPSTASH_REDIS_REST_URL/TOKEN`).

Tanpa storage ini, bot tetap jalan di laptop dengan `data/local_store.json` (sudah terbukti), tetapi
**tidak bisa** jalan di Vercel karena file system-nya tidak bisa ditulis.

### 4.3 Environment variables

| Nama | Contoh / ketentuan |
|---|---|
| `CRON_SECRET` | string acak panjang; endpoint `/api/tick` menolak semua panggilan tanpa ini |
| `UPSTASH_REDIS_REST_URL` | dari marketplace Vercel |
| `UPSTASH_REDIS_REST_TOKEN` | dari marketplace Vercel |
| `PAPER_EQUITY` | `100000000` (default juga Rp100.000.000) |
| `KILL_SWITCH` | `0`; ubah ke `1` untuk berhenti membuka posisi (exit tetap jalan) |

`.env` masuk `.gitignore` dan tidak pernah dikumpulkan. Yang dikumpulkan hanya `.env.example`.

### 4.4 Deploy

```bash
npm i -g vercel        # sudah terpasang di mesin ini
vercel login
vercel link
vercel --prod
```

Region `sin1` (Singapura) sudah dipilih di `vercel.json` agar dekat ke Indodax.

### 4.5 Penjadwal (cron 4 jam)

> **Status nyata saat pengumpulan:** bot sudah berjalan di
> **https://uas-indodax-fin02.vercel.app** (dashboard `/dashboard`, status `/status`) dengan
> storage Upstash Redis. Pemicu 4 jam berjalan dari **GitHub Actions** di repository publik
> **https://github.com/ibrafinnn05/uas-indodax-fin02** (`workflow_dispatch` sudah diuji, run #1 sukses),
> jadi bot tetap hidup walau laptop mati. `vercel.json` juga memuat cron harian `7 0 * * *` sebagai
> jaring pengaman (batas plan Hobby). Pemicu lokal Task Scheduler yang dipakai saat pertama deploy sudah
> **dinonaktifkan** agar tidak dobel.

Vercel Cron Hobby hanya sekali sehari, jadi penjadwal utama yang disarankan adalah **GitHub Actions**
(`.github/workflows/tick.yml`, `cron: '7 */4 * * *'` UTC = 07.07, 11.07, 15.07, 19.07,
23.07, 03.07 WIB). Menit ke-7 dipilih agar tidak menumpuk di menit ke-0.

Isi repository secrets:

- `TICK_URL` = `https://<project>.vercel.app/api/tick`
- `CRON_SECRET` = nilai yang sama dengan environment variable

Uji manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/tick
```

### 4.6 Link setelah deploy

Deployment yang dipakai saat pengumpulan:

- Repositori publik (bukti freeze): https://github.com/ibrafinnn05/uas-indodax-fin02
- Dashboard live: https://uas-indodax-fin02.vercel.app/dashboard (atau `/api/dashboard`, `?format=json` untuk data mentah)
- Status operasional: https://uas-indodax-fin02.vercel.app/status
- Endpoint tick: `POST/GET https://uas-indodax-fin02.vercel.app/api/tick` (wajib header `Authorization: Bearer <CRON_SECRET>`)
- Kill switch: `POST/GET https://uas-indodax-fin02.vercel.app/api/kill?on=1` (atau `?on=0`), header yang sama
- Dashboard offline: `public/index.html` (bisa dibuka tanpa internet)

---

## 5. Log mentah dan hitung ulang

| File | Isi |
|---|---|
| `logs/raw/calls.jsonl` | setiap panggilan bot: waktu, pair OK/invalid, candle diproses, error, latency |
| `logs/raw/orders.jsonl` | setiap order simulasi: sisi, qty, harga fill, bid/ask terbaik, fee, spread, P&L |
| `logs/raw/signals.jsonl` | setiap sinyal dan setiap skip (alasan: kill switch, daily loss, slot, spread…) |
| `logs/raw/equity.jsonl` | equity harian pada panggilan pertama setelah 00.00 WIB |
| `logs/raw/errors.jsonl` | setiap error API/data |
| `logs/raw/spreads.jsonl` | spread bid/ask tiap pasangan tiap panggilan |
| `logs/raw/depth.jsonl` | **snapshot order book mentah** (untuk estimasi spread forward) |
| `logs/raw/state.json` | snapshot state terakhir |

Verifikasi ulang:

```bash
npm run export     # tulis ulang logs/raw dari storage
npm run hitung     # hitung ulang semua angka + dashboard
npm test           # pemeriksaan eksekusi & konsistensi kode
```

---

## 6. Sumber data & biaya (tanggal akses 6 November 2026)

| Kebutuhan | Sumber |
|---|---|
| Candle historis | `https://indodax.com/tradingview/history_v2?symbol=BTCIDR&tf=240&from=…&to=…` |
| Order book | `https://indodax.com/api/depth/btcidr` |
| Ticker semua pasangan | `https://indodax.com/api/ticker_all` |
| Daftar pasangan & fee | `https://indodax.com/api/pairs` (`trade_fee_percent_taker` = 0,2%) |
| Kenaikan harga | `https://indodax.com/api/price_increments` |
| Waktu server | `https://indodax.com/api/server_time` |
| Fee resmi (dipakai) | help.indodax.com — *Rincian Biaya Transaksi di INDODAX* (artikel 4416646599705), diakses 2026-11-06 |
| Spread & slippage | snapshot order book sendiri: `data/depth/` (median 3 ronde, ukuran order Rp25 juta) |

Fee yang dipakai = **angka tertinggi** dari kedua sumber:
beli **0,20555%**, jual **0,41555%** (taker all-in IDR PRO, berlaku 1 Okt 2026).
Minimum order **Rp25.000** (lebih ketat dari `trade_min_base_currency` Rp10.000).

---

## 7. Bukti freeze

| | |
|---|---|
| Repositori publik | https://github.com/ibrafinnn05/uas-indodax-fin02 |
| Commit freeze | `662f5db7b3d93f4baf0e6b545749fa8a7be903cc` (`662f5db`) |
| Waktu commit (WIB) | 2026-11-06 23.22:30 WIB |
| Waktu freeze aturan (data cutoff) | 2026-11-06 19.00 WIB (2026-11-06 12.00 UTC) — aturan dan parameter dibekukan pada waktu ini; commit dijalankan pada hari yang sama, 4 jam kemudian |
| Isi yang dibekukan | aturan strategi (`lib/strategy.js`, `lib/config.js`), universe (`lib/universe.js`), backtest 3 tahun, snapshot order book, `data/freeze.json` |
| Setelah freeze | hanya perbaikan bug yang tidak mengubah aturan; setiap perubahan dicatat di log dan README |

Bukti: `git log --oneline` menunjukkan commit ini sebagai commit pertama; jangan force-push atau
menulis ulang riwayat setelahnya. Isi commit dicatat ulang pada commit kedua
(`catat hash freeze`), sehingga riwayat tetap utuh.

### 7.1 Perubahan pasca-freeze (tanpa mengubah aturan, parameter, universe)

| Commit | Perubahan | Alasan |
|---|---|---|
| `4cc0ffa` | path separator ZIP, zona waktu dashboard WIB, uptime dari candle, uji eksekusi | perbaikan bug pasca-freeze |
| `be3d5bb` | deploy Vercel + Upstash Redis, `.vercelignore`, penjadwal 4 jam | infrastruktur; filesystem Vercel read-only (`EROFS`) |
| `3cb9024` | badge forward menampilkan `PARSIAL x/10 hari` | transparansi status |
| `bf25971` | dokumentasi GitHub Actions sebagai penjadwal cloud | penjadwal tidak boleh bergantung laptop |
| commit dokumentasi ini | snapshot candle bot (`logs/raw/candles.json`) + backtest jendela forward di dashboard live + tabel statistik trade wajib UAS | kelengkapan metrik dashboard; tidak mengubah logika sinyal |
| commit ini | panel **posisi terbuka / order pending / papan pantau** di dashboard + toleransi uptime sampai candle berikutnya tutup | menjawab kebutuhan monitoring tanpa membuat trade palsu; mencegah uptime turun palsu tepat sebelum jadwal |

Tidak ada perubahan pada `lib/strategy.js`, `lib/config.js`, `lib/universe.js`, maupun parameter
yang tercatat di `data/freeze.json`. Perubahan di atas hanya menambah cara **membaca dan
menghitung ulang** hasil yang sudah ada.

---

## 8. Keterbatasan yang diakui

1. **Freeze terlambat** (6 Nov, bukan 4 Nov). Tercatat di `data/freeze.json` dan di dashboard.
2. **Forward < 10 hari** pada saat pengumpulan. Dashboard menandai status "parsial"; angka forward
   bukan hasil final dan tidak boleh dibandingkan mentah-mentah dengan backtest 3 tahun.
3. **Survivorship bias**: `/api/pairs` hanya memuat pair yang masih listing hari ini. Pair yang
   delisting sebelum 2023 tidak bisa dipilih. Kriteria likuiditas diukur pada **30 hari pertama
   periode backtest** (bukan volume hari ini) untuk meminimalkan bias lain.
4. **Backtest di bawah buy & hold BTC** pada periode penuh. Penjelasan di `REFLEKSI.md`.
5. Snapshot order book dikumpulkan 3 ronde × 5 pair pada hari persiapan; jumlahnya jauh lebih
   sedikit daripada target "tiap jam selama pengumpulan". Median tetap dipakai dan jumlahnya
   ditampilkan di dashboard.
6. `data/local_store.json` dan `dist/` tidak dikumpulkan (state lokal hanya untuk pengembangan).

---

## 9. Keamanan

- Endpoint `/api/tick` menolak panggilan tanpa `CRON_SECRET` (perbandingan waktu-konstan).
- Tidak ada API key Indodax di kode atau log; bot hanya memakai API publik.
- Tidak ada secret di repository: `.env` di-ignore, `.env.example` tanpa isi.
- **Kill switch tanpa deploy ulang**: `GET/POST /api/kill?on=1` (atau `?on=0`) dengan header
  `Authorization: Bearer <CRON_SECRET>`. Nilai disimpan di storage (`finn:kill`) dan dibaca setiap
  tick; environment variable `KILL_SWITCH=1` tetap didukung sebagai lapis kedua. Setiap tick yang
  berjalan dengan kill switch aktif mencatat `killSwitch: true` di `logs/raw/calls.jsonl`, dan setiap
  order baru yang dibatalkan tercatat sebagai `kill_switch` / `kill_switch_cancel`.
- Retry dibatasi 3 percobaan dengan backoff; timeout 12 detik per request; pacing maksimal
  3 request/detik.
- Idempotency: tiap candle hanya diproses sekali per pasangan (kunci `finn:seen:<pair>:<candle>`),
  terbukti pada log: panggilan kedua untuk candle yang sama tidak membeli lagi.
