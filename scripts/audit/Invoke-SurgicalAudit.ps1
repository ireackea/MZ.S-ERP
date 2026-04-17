param(
  [switch]$StaticOnly,
  [switch]$RuntimeOnly,
  [string]$OutputRoot = "audit-reports/surgical",
  [switch]$KeepRuntimeArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($StaticOnly -and $RuntimeOnly) {
  throw "Choose either -StaticOnly or -RuntimeOnly, not both."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptRoot "..\..")).Path
$configPath = Join-Path $scriptRoot "audit.config.json"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$mode = if ($StaticOnly) { "static" } elseif ($RuntimeOnly) { "runtime" } else { "full" }
$outputDir = Join-Path $projectRoot $OutputRoot
$runDir = Join-Path $outputDir $timestamp
$composeFileRelative = "docker-compose.yml"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runDir "logs") -Force | Out-Null

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to run the surgical audit."
}

function Write-RuntimeFailureReport {
  param(
    [string]$TargetPath,
    [string]$MessageText,
    [string]$EvidenceText
  )

  $payload = @{
    stage = "runtime"
    generatedAt = (Get-Date).ToString("o")
    checks = @()
    findings = @(
      @{
        severity = "critical"
        category = "runtime"
        ruleId = "runtime-prerequisite-failed"
        title = "Runtime surgical audit could not start"
        description = $MessageText
        evidence = $EvidenceText
        remediation = "Resolve the runtime prerequisite, then rerun the surgical audit in runtime/full mode."
      }
    )
  }

  $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $TargetPath -Encoding UTF8
}

function Invoke-NativeCommandSafely {
  param(
    [scriptblock]$Command
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $global:ErrorActionPreference = 'Continue'
    & $Command
    return $LASTEXITCODE
  }
  finally {
    $global:ErrorActionPreference = $previousErrorActionPreference
  }
}

Push-Location $projectRoot
try {
  if ($mode -ne "runtime") {
    & node ".\scripts\audit\run-static-audit.mjs" --project-root $projectRoot --config $configPath --output-dir $runDir | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Static audit engine failed with exit code $LASTEXITCODE."
    }
  }

  if ($mode -ne "static") {
    $runtimeReportPath = Join-Path $runDir "runtime-report.json"
    $runtimeFailureMessage = $null
    $runtimeFailureEvidence = $null

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
      $runtimeFailureMessage = "Docker is required for runtime surgical audit modes."
    }

    if (-not $runtimeFailureMessage) {
      $composeVersionExitCode = Invoke-NativeCommandSafely { docker compose version *> $null }
      if ($composeVersionExitCode -ne 0) {
        $runtimeFailureMessage = "docker compose is required for runtime surgical audit modes."
      }
    }

    if (-not $runtimeFailureMessage) {
      $dockerInfoOk = $true
      try {
        $dockerInfoExitCode = Invoke-NativeCommandSafely { docker info 2>$null | Out-Null }
        if ($dockerInfoExitCode -ne 0) {
          $dockerInfoOk = $false
        }
      }
      catch {
        $dockerInfoOk = $false
      }
      if (-not $dockerInfoOk) {
        $runtimeFailureMessage = "Docker daemon is not running. Start Docker Desktop (or the engine) before running runtime surgical audit."
      }
    }

    $composeProject = ("mzs-erp-audit-" + $timestamp).ToLowerInvariant()
    $backendPort = Get-Random -Minimum 33001 -Maximum 33999
    $postgresPort = Get-Random -Minimum 35433 -Maximum 35999
    $frontendPort = Get-Random -Minimum 34173 -Maximum 34999
    $backendBaseUrl = "http://127.0.0.1:$backendPort"
    $allowedOrigin = "http://127.0.0.1:$frontendPort"
    $metricsToken = [guid]::NewGuid().ToString("N")
    $jwtSecret = "audit-jwt-" + [guid]::NewGuid().ToString("N")
    $resetToken = "audit-reset-" + [guid]::NewGuid().ToString("N")
    $backupSecret = "audit-backup-" + [guid]::NewGuid().ToString("N")
    $databasePassword = "AuditRuntimePass2026!"
    $adminPassword = "AuditSuperAdmin2026!"
    $overridePath = Join-Path $runDir "docker-compose.audit.override.yml"
    $logsPath = Join-Path $runDir "logs\docker-compose.log"

    $overrideContent = @"
services:
  postgres:
    ports:
      - "${postgresPort}:5432"
    environment:
      POSTGRES_DB: feed_factory_db
      POSTGRES_USER: feedfactory
      POSTGRES_PASSWORD: $databasePassword
  backend:
    ports:
      - "${backendPort}:3001"
    environment:
      DATABASE_URL: postgresql://feedfactory:$databasePassword@postgres:5432/feed_factory_db
      JWT_SECRET: $jwtSecret
      RESET_TOKEN: $resetToken
      BACKUP_ENCRYPTION_SECRET: $backupSecret
      METRICS_AUTH_TOKEN: $metricsToken
      CORS_ORIGINS: $allowedOrigin
      ALLOWED_ORIGINS: $allowedOrigin
      AUTH_COOKIE_SECURE: "false"
      ADMIN_PASSWORD: $adminPassword
      NODE_ENV: production
"@

    if (-not $runtimeFailureMessage) {
      Set-Content -Path $overridePath -Value $overrideContent -Encoding UTF8
      $projectRootUri = New-Object System.Uri(($projectRoot.TrimEnd('\') + '\'))
      $overrideUri = New-Object System.Uri($overridePath)
      $overridePathRelative = $projectRootUri.MakeRelativeUri($overrideUri).ToString()

      try {
        $composeUpExitCode = Invoke-NativeCommandSafely { docker compose -p $composeProject -f $composeFileRelative -f $overridePathRelative up -d --build postgres backend 2>&1 | Tee-Object -FilePath $logsPath }
        if ($composeUpExitCode -ne 0) {
          $runtimeFailureMessage = "Failed to start temporary docker runtime environment."
          $runtimeFailureEvidence = "Inspect logs/docker-compose.log for compose startup details."
        }

        if (-not $runtimeFailureMessage) {
          & node ".\scripts\audit\run-runtime-audit.mjs" `
            --project-root $projectRoot `
            --config $configPath `
            --output-dir $runDir `
            --backend-base-url $backendBaseUrl `
            --allowed-origin $allowedOrigin `
            --metrics-token $metricsToken `
            --auth-username "superadmin" `
            --auth-password $adminPassword | Out-Null
          if ($LASTEXITCODE -ne 0) {
            $runtimeFailureMessage = "Runtime audit engine failed."
            $runtimeFailureEvidence = "Inspect logs/docker-compose.log and the runtime-report artifacts for the failing probe."
          }
        }
      }
      finally {
        if (-not $KeepRuntimeArtifacts) {
          [void](Invoke-NativeCommandSafely { docker compose -p $composeProject -f $composeFileRelative -f $overridePathRelative down -v --remove-orphans 2>&1 | Tee-Object -FilePath $logsPath -Append })
        }
      }
    }

    if ($runtimeFailureMessage) {
      $runtimeEvidenceToWrite = if ($runtimeFailureEvidence) { $runtimeFailureEvidence } else { $runtimeFailureMessage }
      Write-RuntimeFailureReport -TargetPath $runtimeReportPath -MessageText $runtimeFailureMessage -EvidenceText $runtimeEvidenceToWrite
    }
  }

  & node ".\scripts\audit\render-audit-report.mjs" --output-dir $runDir --mode $mode | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to render the final surgical audit report."
  }

  $finalReport = Get-Content (Join-Path $runDir "final-report.json") -Raw | ConvertFrom-Json
  Write-Output "Surgical audit completed."
  Write-Output "Output directory: $runDir"
  exit ([int]$finalReport.exitCode)
}
finally {
  Pop-Location
}
