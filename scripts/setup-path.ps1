# Add local tools to PATH for this session
$root = Split-Path $PSScriptRoot -Parent
$env:Path = "$root\.tools;C:\Users\AB PLUS TECH\AppData\Roaming\npm;$env:USERPROFILE\.cargo\bin;" + $env:Path
Write-Host "PATH updated: stellar=$(stellar --version 2>$null | Select-Object -First 1); pnpm=$(pnpm --version)"
