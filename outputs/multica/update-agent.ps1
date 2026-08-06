param(
  [Parameter(Mandatory = $true)][string]$AgentId,
  [Parameter(Mandatory = $true)][ValidateSet("model", "env")][string]$Action,
  [string]$EnvJsonPath
)

$ErrorActionPreference = "Stop"
$exe = "C:\Users\liuheng\AppData\Local\Programs\@multicadesktop\resources\app.asar.unpacked\resources\bin\multica.exe"
$wid = "f60fcc5b-ad39-4dc3-ae91-bd9d9571440f"

function Invoke-Multica {
  param([string[]]$ArgList)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $exe
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $parts = foreach ($a in $ArgList) {
    '"' + ($a -replace '"', '\"') + '"'
  }
  $psi.Arguments = $parts -join ' '
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  Write-Output "EXIT=$($p.ExitCode)"
  Write-Output $out
  if ($err) { Write-Output "STDERR: $err" }
  return $p.ExitCode
}

if ($Action -eq "model") {
  $argList = @(
    "--profile", "desktop-api.multica.ai",
    "--workspace-id", $wid,
    "agent", "update", $AgentId,
    "--model", "glm-5.2",
    "--description", "Codex CLI + 智谱 GLM-5.2 旗舰模型",
    "--custom-args", '["-c","model_provider=zhipu","-c","model_provider.zhipu.name=zhipu","-c","model_provider.zhipu.base_url=https://open.bigmodel.cn/api/paas/v4","-c","model_provider.zhipu.env_key=ZHIPU_API_KEY","-c","model_provider.zhipu.wire_api=chat"]'
  )
  Invoke-Multica $argList
} elseif ($Action -eq "env") {
  if (-not $EnvJsonPath -or -not (Test-Path $EnvJsonPath)) {
    Write-Output "请提供 --EnvJsonPath 指向环境变量 JSON 文件"
    exit 1
  }
  $argList = @(
    "--profile", "desktop-api.multica.ai",
    "--workspace-id", $wid,
    "agent", "env", "set", $AgentId,
    "--custom-env-file", $EnvJsonPath
  )
  Invoke-Multica $argList
}
