# Downloads the free DB-IP Lite databases (CC BY 4.0, https://db-ip.com) into native/geo.
# DB-IP publishes each month's files a few days in, so this falls back to last month.
param([string]$Month)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $PSScriptRoot '..\native\geo'
New-Item -ItemType Directory -Force $dir | Out-Null
$months = if ($Month) { @($Month) } else { @((Get-Date).ToString('yyyy-MM'), (Get-Date).AddMonths(-1).ToString('yyyy-MM')) }

foreach ($kind in 'asn', 'country') {
    $gz = Join-Path $dir "dbip-$kind-lite.mmdb.gz"
    $done = $false
    foreach ($m in $months) {
        try {
            Invoke-WebRequest -UseBasicParsing "https://download.db-ip.com/free/dbip-$kind-lite-$m.mmdb.gz" -OutFile $gz
            $done = $true
            Write-Host "dbip-$kind-lite: $m"
            break
        }
        catch {
            Write-Host "dbip-$kind-lite-$m not available: $($_.Exception.Message)"
        }
    }
    if (-not $done) { throw "Could not download dbip-$kind-lite for $($months -join ' or ')" }

    $in = [IO.File]::OpenRead($gz)
    $out = [IO.File]::Create((Join-Path $dir "dbip-$kind-lite.mmdb"))
    $unzip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $unzip.CopyTo($out)
    $unzip.Dispose(); $out.Dispose(); $in.Dispose()
    Remove-Item $gz
}
Get-ChildItem $dir | Select-Object Name, Length
