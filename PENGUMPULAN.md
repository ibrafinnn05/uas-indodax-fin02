# Paket Pengumpulan UAS — FINN 02 Indodax Dry Run

Dokumen ini adalah checklist final untuk diunggah ke RISE.

## Link yang wajib ditempel di kolom catatan RISE

- **Dashboard live:** https://uas-indodax-fin02.vercel.app/dashboard
- **Status bot:** https://uas-indodax-fin02.vercel.app/status
- **Repositori publik (riwayat commit lengkap):** https://github.com/ibrafinnn05/uas-indodax-fin02

## Bukti freeze

- Commit freeze: **`662f5db`**
- Waktu commit freeze: **2026-11-06 23:22:30 WIB**
- Data cutoff: **2026-11-06 19:00 WIB** (`2026-11-06T12:00:00Z`)
- Catatan: freeze terlambat dari jadwal UAS (4 Nov 12.00 WIB) dan dicatat jujur di README,
  `data/freeze.json`, dan dashboard.
- Riwayat commit tersedia di repo publik dan folder `.git` ikut di dalam ZIP.

## Isi ZIP

| Bahan UAS | Lokasi di ZIP |
|---|---|
| Source code bot + backtest | `lib/`, `api/`, `scripts/` |
| README cara menjalankan & deploy | `README.md` |
| Strategi tertulis + perubahan dari UTS | `STRATEGI.md` |
| Refleksi backtest vs forward | `REFLEKSI.md` |
| Log mentah forward (calls, orders, equity, errors, spreads, depth) | `logs/raw/` |
| Snapshot order book | `logs/raw/depth.jsonl`, `data/depth/raw/` |
| Snapshot candle bot | `logs/raw/candles.json` |
| Skrip hitung ulang | `scripts/hitung_ulang.js` (`npm run hitung`) |
| Dashboard HTML offline mandiri | `public/index.html` |
| Bukti uji eksekusi | `logs/test/execution.txt` |
| Environment contoh tanpa secret | `.env.example` |
| Riwayat commit/freeze | `.git/` |

## Ringkasan hasil final

| Metrik | Nilai |
|---|---:|
| Backtest 3 tahun | +73,46% · CAGR +20,14% · MDD −24,29% · PF 1,44 · 186 trade |
| In-sample | CAGR +25,87% · MDD −18,07% |
| Out-of-sample | CAGR +9,44% · MDD −10,43% |
| Forward | **7,89 / 10 hari** · return 0,00% · MDD 0,00% · 0 trade |
| Uptime candle | **48 / 48 = 100%** |
| Panggilan tick | 63 |
| Error API/data | 0 |
| Sinyal / order | 0 / 0 |
| Snapshot spread & depth | 315 / 315 |
| BTC/IDR benchmark jendela forward | −10,88% |

## Catatan jujur untuk pengumpulan

1. **Forward belum 10 hari penuh.** Saat pengumpulan berjalan **7,89 hari**; dashboard menandai
   status **PARSIAL**. Ini terjadi karena freeze baru dilakukan 6 Nov, bukan 4 Nov.
2. **0 trade bukan kegagalan bot.** Selama 48 candle, kelima pair tidak pernah menembus HHV20 dan
   MA50 sekaligus. Backtest pada candle yang sama juga menghasilkan 0 sinyal, sehingga kecocokan
   sinyal 0/0. Rubrik UAS mengizinkan 0 trade bila log sinyal cocok dengan backtest.
3. **Spread forward lebih rendah dari asumsi backtest** untuk 4 dari 5 pair; angka median per pair
   ada di `REFLEKSI.md` dan dashboard.
4. **Tidak ada secret** di repo/ZIP. `.env`, `.env.*`, `.tick_secret`, dan `data/local_store.json`
   dikecualikan. Endpoint `/api/tick` dilindungi `CRON_SECRET`.

## Perintah verifikasi cepat

```bash
npm test          # 24 pemeriksaan eksekusi
npm run hitung    # hitung ulang backtest + forward + dashboard offline
npm run zip       # buat dist/uas-indodax-submit.zip
```
