param(
  [switch]$SkipMirror
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot

if (-not $SkipMirror) {
  # 国内网络环境下加速 electron / electron-builder 二进制下载
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

Write-Host "Rebuilding desktop package (release\setup.exe)..."
Push-Location $here
try {
  npm run dist
} finally {
  Pop-Location
}
Write-Host "Build finished."
