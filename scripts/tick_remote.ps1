# Pemicu tick FINN 02 (pengganti sementara GitHub Actions).
# Dipanggil Task Scheduler tiap 4 jam pada menit ke-7 (candle 4 jam tutup pada :00).
# Secret dibaca dari file .tick_secret di root repo (tidak pernah di-commit).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secretFile = Join-Path $root '.tick_secret'
$url = 'https://uas-indodax-fin02.vercel.app/api/tick'
$logDir = Join-Path $root 'logs\remote'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'ticks.log'

function Write-Log($text) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format o), $text) -Encoding utf8
}

if (-not (Test-Path $secretFile)) {
  Write-Log 'ERROR file .tick_secret tidak ada'
  exit 1
}
$secret = (Get-Content $secretFile -Raw).Trim()

try {
  $body = curl.exe -s -S -H "Authorization: Bearer $secret" --max-time 150 $url
  if (-not $body) { throw 'respons kosong' }
  $j = $body | ConvertFrom-Json
  $candles = @($j.processedCandles).Count
  $orders = @($j.orders).Count
  $ok = if ($j.ok) { 'OK' } else { 'GAGAL' }
  Write-Log ("{0} candle={1} order={2} equity={3} pairsOk={4} error={5}" -f $ok, $candles, $orders, $j.equity, @($j.pairsOk).Count, $j.error)
} catch {
  Write-Log ("ERROR {0}" -f $_.Exception.Message)
  exit 1
}
