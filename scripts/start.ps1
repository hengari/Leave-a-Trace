param(
  [int]$Port = 8787,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$serve = Join-Path $here "serve.mjs"

# 优先使用 Codex 捆绑运行时里的 Node，找不到则回退到系统 Node
$runtimeNode = "C:\Users\liuheng\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if (Test-Path $runtimeNode) { $runtimeNode } else { "node" }

$url = "http://127.0.0.1:$Port/"

Write-Host "正在启动留痕原型（本地服务 $url）..."
$proc = Start-Process -FilePath $node -ArgumentList @($serve, "--port", $Port) -WindowStyle Hidden -PassThru

# 等待服务就绪（最多 10 秒）
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    # 尚未就绪，继续等待
  }
}

if (-not $ready) {
  Write-Error "服务启动失败，请确认端口 $Port 未被占用，或先运行：node `"$serve`""
  exit 1
}

Write-Host "服务已就绪：$url"
if (-not $NoBrowser) {
  Start-Process $url
}

Write-Host "按任意键关闭本地服务..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
