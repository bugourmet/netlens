# Everything that should pass before a commit: types, lint and tests for the UI and the C# core.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm run check
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    dotnet test native/NetLens.Core.Tests
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    dotnet build native/NetLens.Capture -warnaserror
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    Write-Host 'All checks passed.'
}
finally {
    Pop-Location
}
