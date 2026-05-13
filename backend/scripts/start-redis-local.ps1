param(
  [string]$RedisServerPath = ""
)

$ErrorActionPreference = "Stop"

$BackendRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ConfigPath = Join-Path $BackendRoot "redis.local.conf"
$DataDir = Join-Path $BackendRoot "redis-data"

New-Item -ItemType Directory -Force $DataDir | Out-Null

if (-not $RedisServerPath) {
  $cmd = Get-Command redis-server -ErrorAction SilentlyContinue
  if ($cmd) {
    $RedisServerPath = $cmd.Source
  } else {
    $portable = Join-Path $env:USERPROFILE "Downloads\redis-portable\redis-server.exe"
    if (Test-Path $portable) {
      $RedisServerPath = $portable
    }
  }
}

if (-not $RedisServerPath -or -not (Test-Path $RedisServerPath)) {
  throw "redis-server.exe not found. Pass -RedisServerPath C:\path\to\redis-server.exe"
}

Write-Host "Starting Redis: $RedisServerPath"
Write-Host "Config: $ConfigPath"

Push-Location $BackendRoot
try {
  & $RedisServerPath $ConfigPath
} finally {
  Pop-Location
}
