# Builds the UI into the shell, then the Windows app.
param([string]$Configuration = 'Debug')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

Push-Location $root
try {
    # Textures aren't in git; fetch or generate them on a fresh clone.
    if (-not (Test-Path public/textures/earth-day.jpg) -or -not (Test-Path public/textures/earth-night.jpg)) {
        & (Join-Path $PSScriptRoot 'get-earth-textures.ps1')
    }
    if (-not (Test-Path public/textures/earth-water.png)) {
        node tools/make-land-data.mjs
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
    }

    npx tsc --noEmit
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    npx vite build --mode hybrid --emptyOutDir --outDir native/NetLens.App/Resources/Raw/wwwroot
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    dotnet build native/NetLens.App -c $Configuration
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    Write-Host "Built: native\NetLens.App\bin\$Configuration\net9.0-windows10.0.19041.0\win-x64\NetLens.App.exe"
}
finally {
    Pop-Location
}
