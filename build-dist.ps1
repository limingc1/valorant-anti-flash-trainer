# Build the deployable dist/ folder locally.
#   powershell -ExecutionPolicy Bypass -File build-dist.ps1
# CI (.github/workflows/ci.yml) only runs the tests, it does not build dist/.
# So this script is for a manual wrangler upload or for serving dist/ locally.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads .ps1 as ANSI unless a
# BOM is present, which mangles non-ASCII literals.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Remove-Item -LiteralPath dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path dist/sfx -Force | Out-Null

Copy-Item -LiteralPath valorant-anti-flash-trainer.html -Destination dist/index.html
Copy-Item -LiteralPath logo.svg -Destination dist/logo.svg
Copy-Item -LiteralPath sfx/README.md, sfx/split-recorded.py -Destination dist/sfx/

# Sound effects are tracked in git, but copy them explicitly so a fresh checkout
# always lands them in dist/.
Get-ChildItem -LiteralPath sfx -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.mp3', '.wav', '.ogg', '.m4a' } |
    Copy-Item -Destination dist/sfx/

# Music box tracks. The in-game scan fetches music/manifest.json, so both the
# manifest and the tracks it lists have to be present or the list comes up empty.
New-Item -ItemType Directory -Path dist/music -Force | Out-Null
Get-ChildItem -LiteralPath music -File -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Extension -in '.mp3', '.wav', '.ogg', '.m4a', '.flac') -or
        ($_.Name -eq 'README.md') -or ($_.Name -eq 'manifest.json')
    } |
    Copy-Item -Destination dist/music/

$src = 'valorant-anti-flash-trainer.html'
Write-Output ("dist/index.html  {0} bytes  md5 src={1} out={2}" -f `
    (Get-Item 'dist/index.html').Length,
    (Get-FileHash -Algorithm MD5 -LiteralPath $src).Hash,
    (Get-FileHash -Algorithm MD5 -LiteralPath 'dist/index.html').Hash)
Write-Output 'dist/ built'
