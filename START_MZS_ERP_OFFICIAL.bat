@echo off
setlocal EnableExtensions
chcp 65001 >nul
title MZ.S-ERP Official Runtime Launcher

set "MZS_ERP_LAUNCHER=%~f0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] powershell.exe is required but was not found.
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$raw = Get-Content -LiteralPath $env:MZS_ERP_LAUNCHER -Raw; $parts = $raw -split ':__MZS_ERP_OFFICIAL_PS__\r?\n', 2; if ($parts.Count -lt 2) { throw 'Embedded launcher script marker was not found.' }; & ([ScriptBlock]::Create($parts[1])) @args" %*
set "MZS_ERP_EXIT=%ERRORLEVEL%"

if not "%MZS_ERP_EXIT%"=="0" (
  echo.
  echo [FAILED] Official launcher finished with exit code %MZS_ERP_EXIT%.
  echo Check logs\official-start-*.log for details.
) else (
  echo.
  echo [OK] Official launcher finished successfully.
)

exit /b %MZS_ERP_EXIT%

:__MZS_ERP_OFFICIAL_PS__
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LauncherArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:LauncherFile = [Environment]::GetEnvironmentVariable('MZS_ERP_LAUNCHER')
if ([string]::IsNullOrWhiteSpace($script:LauncherFile)) {
    throw 'MZS_ERP_LAUNCHER environment variable is missing.'
}

$script:Root = Split-Path -Parent $script:LauncherFile
$script:ComposeFile = Join-Path $script:Root 'docker-compose.yml'
$script:EnvFile = Join-Path $script:Root '.env'
$script:EnvExampleFile = Join-Path $script:Root '.env.example'
$script:LogsDir = Join-Path $script:Root 'logs'
$script:TempDir = Join-Path $script:Root 'temp'
$script:Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:LogPath = Join-Path $script:LogsDir ("official-start-{0}.log" -f $script:Timestamp)
$script:HealthJsonl = Join-Path $script:LogsDir ("official-health-{0}.jsonl" -f $script:Timestamp)
$script:LatestStatusPath = Join-Path $script:TempDir 'official-status-latest.json'
$script:ProjectServices = @('postgres', 'backend', 'frontend')
$script:FrontendUrl = 'http://localhost:4173'
$script:BackendHealthUrl = 'http://localhost:3001/api/health'
$script:ProxyHealthUrl = 'http://localhost:4173/api/health'
$script:MetricsUrl = 'http://localhost:3001/metrics'

$script:Options = [ordered]@{
    Build = $true
    OpenBrowser = $true
    Monitor = $true
    Stop = $false
    Clean = $false
    Status = $false
    Logs = $false
    Doctor = $false
    Pull = $false
    Help = $false
    TimeoutSeconds = 300
    MonitorIntervalSeconds = 10
    HealthGraceSeconds = 90
}

function Show-Help {
    Write-Host ''
    Write-Host 'MZ.S-ERP Official Runtime Launcher'
    Write-Host ''
    Write-Host 'Usage:'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /no-build /no-browser /no-monitor'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /status'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /logs'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /stop'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /clean'
    Write-Host '  START_MZS_ERP_OFFICIAL.bat /doctor'
    Write-Host ''
    Write-Host 'Switches:'
    Write-Host '  /no-build       Start existing images without rebuilding.'
    Write-Host '  /pull           Pull base/service images before startup.'
    Write-Host '  /no-browser     Do not open the frontend after successful startup.'
    Write-Host '  /no-monitor     Exit after startup checks instead of live dashboard.'
    Write-Host '  /status         Print current container, endpoint, and resource status.'
    Write-Host '  /logs           Print recent docker compose logs.'
    Write-Host '  /stop           Stop the official stack but keep containers/volumes.'
    Write-Host '  /clean          Compose down with --remove-orphans, volumes are kept.'
    Write-Host '  /doctor         Run preflight/config checks only.'
    Write-Host '  /timeout:N      Startup timeout in seconds, default 300.'
    Write-Host '  /interval:N     Live monitor refresh interval in seconds, default 10.'
    Write-Host '  /health-grace:N Seconds to wait for Docker health after HTTP readiness, default 90.'
    Write-Host ''
}

function Initialize-Options {
    foreach ($rawArg in $LauncherArgs) {
        $arg = ([string]$rawArg).Trim()
        if (-not $arg) { continue }

        switch -Regex ($arg.ToLowerInvariant()) {
            '^/\?$|^/h$|^/help$|^-h$|^--help$' { $script:Options.Help = $true; continue }
            '^/no-build$' { $script:Options.Build = $false; continue }
            '^/pull$' { $script:Options.Pull = $true; continue }
            '^/no-browser$' { $script:Options.OpenBrowser = $false; continue }
            '^/no-monitor$' { $script:Options.Monitor = $false; continue }
            '^/status$' { $script:Options.Status = $true; $script:Options.Monitor = $false; continue }
            '^/logs$' { $script:Options.Logs = $true; $script:Options.Monitor = $false; continue }
            '^/stop$' { $script:Options.Stop = $true; $script:Options.Monitor = $false; continue }
            '^/clean$' { $script:Options.Clean = $true; $script:Options.Monitor = $false; continue }
            '^/doctor$' { $script:Options.Doctor = $true; $script:Options.Monitor = $false; continue }
            '^/timeout:(\d+)$' { $script:Options.TimeoutSeconds = [Math]::Max(30, [int]$Matches[1]); continue }
            '^/interval:(\d+)$' { $script:Options.MonitorIntervalSeconds = [Math]::Max(3, [int]$Matches[1]); continue }
            '^/health-grace:(\d+)$' { $script:Options.HealthGraceSeconds = [Math]::Max(0, [int]$Matches[1]); continue }
            default { throw "Unknown launcher switch: $arg. Use /help." }
        }
    }
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO', 'OK', 'WARN', 'ERROR')]
        [string]$Level = 'INFO'
    )

    $line = '[{0}][{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $script:LogPath -Value $line -Encoding UTF8

    $color = switch ($Level) {
        'OK' { 'Green' }
        'WARN' { 'Yellow' }
        'ERROR' { 'Red' }
        default { 'Cyan' }
    }
    Write-Host $line -ForegroundColor $color
}

function Section {
    param([string]$Title)
    Write-Log ("===== {0} =====" -f $Title)
}

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $script:Root,
        [switch]$AllowFailure,
        [switch]$Quiet
    )

    if (-not $Quiet) {
        Write-Log ("$FilePath $($Arguments -join ' ')")
    }

    $previous = $ErrorActionPreference
    $nativePreferenceSupported = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $previousNativePreference = $null
    if ($nativePreferenceSupported) {
        $previousNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }
    $ErrorActionPreference = 'Continue'

    Push-Location $WorkingDirectory
    try {
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        foreach ($line in @($output)) {
            $text = [string]$line
            Add-Content -Path $script:LogPath -Value $text -Encoding UTF8
            if (-not $Quiet) { Write-Host $text }
        }

        if ($exitCode -ne 0 -and -not $AllowFailure) {
            throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
        }

        return [pscustomobject]@{
            ExitCode = [int]$exitCode
            Output = (@($output) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        }
    } finally {
        Pop-Location
        $ErrorActionPreference = $previous
        if ($nativePreferenceSupported) { $PSNativeCommandUseErrorActionPreference = $previousNativePreference }
    }
}

function Invoke-Compose {
    param(
        [string[]]$Arguments,
        [switch]$AllowFailure,
        [switch]$Quiet
    )
    $composeArgs = @('compose', '-f', $script:ComposeFile) + $Arguments
    return Invoke-Native -FilePath 'docker' -Arguments $composeArgs -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Read-EnvFile {
    param([string]$Path)

    $map = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($rawLine)) { continue }
        $trimmed = $rawLine.Trim()
        if ($trimmed.StartsWith('#') -or -not $rawLine.Contains('=')) { continue }
        $parts = $rawLine -split '=', 2
        if ($parts.Count -ne 2) { continue }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key) { $map[$key] = $value }
    }
    return $map
}

function Get-EnvValue {
    param(
        [System.Collections.IDictionary]$Map,
        [string]$Key,
        [string]$Default = ''
    )
    if ($Map.Contains($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Map[$Key])) {
        return [string]$Map[$Key]
    }
    return $Default
}

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $replacement = '{0}={1}' -f $Key, $Value
    $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='

    if (-not (Test-Path -LiteralPath $Path)) {
        Set-Content -Path $Path -Value $replacement -Encoding UTF8
        return
    }

    $updated = $false
    $newContent = foreach ($line in Get-Content -LiteralPath $Path) {
        if (-not $updated -and $line -match $pattern) {
            $updated = $true
            $replacement
        } else {
            $line
        }
    }

    if ($updated) {
        Set-Content -Path $Path -Value $newContent -Encoding UTF8
    } else {
        Add-Content -Path $Path -Value $replacement -Encoding UTF8
    }
}

function Test-PlaceholderValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    return $Value -match '^<' -or $Value -match '^CHANGE_THIS' -or $Value -match 'example' -or $Value -match 'placeholder'
}

function New-HexToken {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Merge-Origins {
    param([string]$Raw)

    $ordered = New-Object System.Collections.Specialized.OrderedDictionary
    $required = @(
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://127.0.0.1:5173'
    )
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($Raw)) { $candidates += ($Raw -split ',') }
    $candidates += $required

    foreach ($candidate in $candidates) {
        $origin = ([string]$candidate).Trim().TrimEnd('/')
        if (-not $origin) { continue }
        $key = $origin.ToLowerInvariant()
        if (-not $ordered.Contains($key)) { $ordered.Add($key, $origin) }
    }
    return (($ordered.Values | ForEach-Object { [string]$_ }) -join ',')
}

function Ensure-OfficialEnv {
    Section 'ENVIRONMENT'

    if (-not (Test-Path -LiteralPath $script:EnvFile)) {
        if (Test-Path -LiteralPath $script:EnvExampleFile) {
            Copy-Item -Path $script:EnvExampleFile -Destination $script:EnvFile -Force
            Write-Log 'Created .env from .env.example.' 'OK'
        } else {
            Set-Content -Path $script:EnvFile -Value '' -Encoding UTF8
            Write-Log 'Created empty .env because no .env.example exists.' 'WARN'
        }
    }

    $envMap = Read-EnvFile -Path $script:EnvFile
    $postgresUser = Get-EnvValue -Map $envMap -Key 'POSTGRES_USER' -Default 'feedfactory'
    $postgresDb = Get-EnvValue -Map $envMap -Key 'POSTGRES_DB' -Default 'feed_factory_db'
    $postgresPassword = Get-EnvValue -Map $envMap -Key 'POSTGRES_PASSWORD'

    if (Test-PlaceholderValue -Value $postgresUser) { $postgresUser = 'feedfactory'; Set-EnvValue -Path $script:EnvFile -Key 'POSTGRES_USER' -Value $postgresUser }
    if (Test-PlaceholderValue -Value $postgresDb) { $postgresDb = 'feed_factory_db'; Set-EnvValue -Path $script:EnvFile -Key 'POSTGRES_DB' -Value $postgresDb }
    if (Test-PlaceholderValue -Value $postgresPassword) {
        $postgresPassword = New-HexToken -Bytes 24
        Set-EnvValue -Path $script:EnvFile -Key 'POSTGRES_PASSWORD' -Value $postgresPassword
        Write-Log 'Generated POSTGRES_PASSWORD.' 'OK'
    }

    $encodedPassword = [System.Uri]::EscapeDataString($postgresPassword)
    $composeDatabaseUrl = 'postgresql://{0}:{1}@postgres:5432/{2}' -f $postgresUser, $encodedPassword, $postgresDb
    $directDatabaseUrl = 'postgresql://{0}:{1}@localhost:5432/{2}' -f $postgresUser, $encodedPassword, $postgresDb

    $envMap = Read-EnvFile -Path $script:EnvFile
    $databaseUrl = Get-EnvValue -Map $envMap -Key 'DATABASE_URL'
    if (Test-PlaceholderValue -Value $databaseUrl -or $databaseUrl -match '@(localhost|127\.0\.0\.1):5432') {
        Set-EnvValue -Path $script:EnvFile -Key 'DATABASE_URL' -Value $composeDatabaseUrl
        Write-Log 'Normalized DATABASE_URL for Docker service-to-service networking.' 'OK'
    }

    $databaseDirectUrl = Get-EnvValue -Map $envMap -Key 'DATABASE_DIRECT_URL'
    if (Test-PlaceholderValue -Value $databaseDirectUrl -or $databaseDirectUrl -match '@postgres:5432') {
        Set-EnvValue -Path $script:EnvFile -Key 'DATABASE_DIRECT_URL' -Value $directDatabaseUrl
        Write-Log 'Normalized DATABASE_DIRECT_URL for host access.' 'OK'
    }

    foreach ($secretSpec in @(
        @{ Key = 'JWT_SECRET'; Bytes = 32; Min = 32 },
        @{ Key = 'BACKUP_ENCRYPTION_SECRET'; Bytes = 32; Min = 32 },
        @{ Key = 'SYSTEM_RESET_TOKEN'; Bytes = 24; Min = 16 },
        @{ Key = 'METRICS_AUTH_TOKEN'; Bytes = 32; Min = 32 }
    )) {
        $envMap = Read-EnvFile -Path $script:EnvFile
        $current = Get-EnvValue -Map $envMap -Key $secretSpec.Key
        if ((Test-PlaceholderValue -Value $current) -or $current.Length -lt [int]$secretSpec.Min) {
            Set-EnvValue -Path $script:EnvFile -Key $secretSpec.Key -Value (New-HexToken -Bytes ([int]$secretSpec.Bytes))
            Write-Log ("Generated secure value for {0}." -f $secretSpec.Key) 'OK'
        }
    }

    $envMap = Read-EnvFile -Path $script:EnvFile
    $adminPassword = Get-EnvValue -Map $envMap -Key 'ADMIN_PASSWORD'
    if ((Test-PlaceholderValue -Value $adminPassword) -or $adminPassword.Length -lt 12) {
        Set-EnvValue -Path $script:EnvFile -Key 'ADMIN_PASSWORD' -Value ('Aa1!' + (New-HexToken -Bytes 16))
        Write-Log 'Generated ADMIN_PASSWORD.' 'OK'
    }

    $envMap = Read-EnvFile -Path $script:EnvFile
    $origins = Merge-Origins -Raw (Get-EnvValue -Map $envMap -Key 'CORS_ORIGINS')
    Set-EnvValue -Path $script:EnvFile -Key 'CORS_ORIGINS' -Value $origins
    Set-EnvValue -Path $script:EnvFile -Key 'ALLOWED_ORIGINS' -Value $origins
    Set-EnvValue -Path $script:EnvFile -Key 'PORT' -Value '3001'
    Set-EnvValue -Path $script:EnvFile -Key 'NODE_ENV' -Value 'production'
    Set-EnvValue -Path $script:EnvFile -Key 'VITE_API_URL' -Value '/api'
    Set-EnvValue -Path $script:EnvFile -Key 'VITE_BACKEND_ORIGIN' -Value 'http://localhost:3001'

    Write-Log '.env is present and official Docker runtime values are normalized.' 'OK'
}

function Invoke-Preflight {
    Section 'PRE-FLIGHT'

    foreach ($path in @(
        $script:ComposeFile,
        (Join-Path $script:Root 'backend\Dockerfile'),
        (Join-Path $script:Root 'frontend\Dockerfile'),
        (Join-Path $script:Root 'frontend\nginx.frontend.conf')
    )) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required file is missing: $path" }
    }

    foreach ($command in @('docker')) {
        if (-not (Test-CommandAvailable -Name $command)) { throw "Required command is not available: $command" }
    }

    Invoke-Native -FilePath 'docker' -Arguments @('version') | Out-Null
    Invoke-Native -FilePath 'docker' -Arguments @('compose', 'version') | Out-Null
    Invoke-Native -FilePath 'docker' -Arguments @('info') -Quiet | Out-Null
    Write-Log 'Docker engine and compose plugin are available.' 'OK'
}

function Get-ComposeContainerId {
    param([string]$Service)
    $result = Invoke-Compose -Arguments @('ps', '-q', $Service) -AllowFailure -Quiet
    return $result.Output.Trim()
}

function Get-ContainerInspectObject {
    param([string]$ContainerId)
    if ([string]::IsNullOrWhiteSpace($ContainerId)) { return $null }
    $inspect = Invoke-Native -FilePath 'docker' -Arguments @('inspect', $ContainerId) -AllowFailure -Quiet
    if ($inspect.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($inspect.Output)) { return $null }
    return @($inspect.Output | ConvertFrom-Json)[0]
}

function Get-ServiceStatus {
    param([string]$Service)
    $id = Get-ComposeContainerId -Service $Service
    $inspect = Get-ContainerInspectObject -ContainerId $id
    if ($null -eq $inspect) {
        return [ordered]@{ service = $Service; id = ''; name = ''; state = 'missing'; health = 'none'; restartCount = 0 }
    }

    $health = 'none'
    $healthProperty = $inspect.State.PSObject.Properties['Health']
    if ($healthProperty -and $healthProperty.Value -and $healthProperty.Value.Status) {
        $health = [string]$healthProperty.Value.Status
    }

    return [ordered]@{
        service = $Service
        id = ([string]$inspect.Id).Substring(0, 12)
        name = ([string]$inspect.Name).TrimStart('/')
        state = [string]$inspect.State.Status
        health = $health
        restartCount = [int]$inspect.RestartCount
        startedAt = [string]$inspect.State.StartedAt
    }
}

function Get-DockerStats {
    $ids = foreach ($service in $script:ProjectServices) {
        $id = Get-ComposeContainerId -Service $service
        if ($id) { $id }
    }
    if (-not $ids -or $ids.Count -eq 0) { return @() }

    $stats = Invoke-Native -FilePath 'docker' -Arguments (@('stats', '--no-stream', '--format', '{{json .}}') + $ids) -AllowFailure -Quiet
    if ($stats.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stats.Output)) { return @() }

    $items = @()
    foreach ($line in ($stats.Output -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $items += ($line | ConvertFrom-Json) } catch { }
    }
    return $items
}

function Test-HttpEndpoint {
    param(
        [string]$Name,
        [string]$Url,
        [hashtable]$Headers = @{}
    )
    try {
        $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 5
        return [ordered]@{ name = $Name; url = $Url; ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400); status = [int]$response.StatusCode }
    } catch {
        return [ordered]@{ name = $Name; url = $Url; ok = $false; status = 0; error = $_.Exception.Message }
    }
}

function Get-MetricsHeaders {
    $envMap = Read-EnvFile -Path $script:EnvFile
    $token = Get-EnvValue -Map $envMap -Key 'METRICS_AUTH_TOKEN'
    if ([string]::IsNullOrWhiteSpace($token)) { return @{} }
    return @{ 'x-metrics-token' = $token }
}

function Get-StatusSnapshot {
    $services = foreach ($service in $script:ProjectServices) { Get-ServiceStatus -Service $service }
    $endpoints = @(
        (Test-HttpEndpoint -Name 'frontend' -Url $script:FrontendUrl),
        (Test-HttpEndpoint -Name 'backend-health' -Url $script:BackendHealthUrl),
        (Test-HttpEndpoint -Name 'frontend-api-proxy' -Url $script:ProxyHealthUrl),
        (Test-HttpEndpoint -Name 'metrics' -Url $script:MetricsUrl -Headers (Get-MetricsHeaders))
    )
    $stats = @(Get-DockerStats)

    return [ordered]@{
        timestamp = (Get-Date).ToString('o')
        root = $script:Root
        composeFile = $script:ComposeFile
        frontendUrl = $script:FrontendUrl
        backendHealthUrl = $script:BackendHealthUrl
        metricsUrl = $script:MetricsUrl
        services = $services
        endpoints = $endpoints
        stats = $stats
        logPath = $script:LogPath
    }
}

function Save-StatusSnapshot {
    param([System.Collections.IDictionary]$Snapshot)
    $json = $Snapshot | ConvertTo-Json -Depth 8
    Set-Content -Path $script:LatestStatusPath -Value $json -Encoding UTF8
    Add-Content -Path $script:HealthJsonl -Value ($json -replace "`r?`n", '') -Encoding UTF8
}

function Show-Dashboard {
    param([System.Collections.IDictionary]$Snapshot)

    Clear-Host
    Write-Host 'MZ.S-ERP OFFICIAL RUNTIME DASHBOARD' -ForegroundColor Cyan
    Write-Host ('Timestamp : {0}' -f $Snapshot.timestamp)
    Write-Host ('Frontend  : {0}' -f $Snapshot.frontendUrl)
    Write-Host ('Backend   : {0}' -f $Snapshot.backendHealthUrl)
    Write-Host ('Metrics   : {0}' -f $Snapshot.metricsUrl)
    Write-Host ('Log       : {0}' -f $Snapshot.logPath)
    Write-Host ''

    Write-Host 'Services:' -ForegroundColor Cyan
    foreach ($service in $Snapshot.services) {
        $level = if ($service.state -eq 'running' -and ($service.health -in @('healthy', 'none'))) { 'Green' } elseif ($service.state -eq 'running') { 'Yellow' } else { 'Red' }
        Write-Host ('  {0,-10} state={1,-10} health={2,-10} restarts={3}' -f $service.service, $service.state, $service.health, $service.restartCount) -ForegroundColor $level
    }

    Write-Host ''
    Write-Host 'Endpoints:' -ForegroundColor Cyan
    foreach ($endpoint in $Snapshot.endpoints) {
        $level = if ($endpoint.ok) { 'Green' } else { 'Red' }
        Write-Host ('  {0,-18} status={1,-3} {2}' -f $endpoint.name, $endpoint.status, $endpoint.url) -ForegroundColor $level
    }

    Write-Host ''
    Write-Host 'Resources:' -ForegroundColor Cyan
    foreach ($stat in $Snapshot.stats) {
        Write-Host ('  {0,-24} CPU={1,-8} MEM={2,-18} NET={3}' -f $stat.Name, $stat.CPUPerc, $stat.MemUsage, $stat.NetIO)
    }

    Write-Host ''
    Write-Host ('Next refresh in {0}s. Press Ctrl+C to stop monitoring; containers keep running.' -f $script:Options.MonitorIntervalSeconds) -ForegroundColor Yellow
}

function Wait-ForServiceHttp {
    param(
        [string]$Name,
        [string]$Url,
        [hashtable]$Headers = @{}
    )

    $deadline = (Get-Date).AddSeconds([int]$script:Options.TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $result = Test-HttpEndpoint -Name $Name -Url $Url -Headers $Headers
        if ($result.ok) {
            Write-Log ("{0} is ready at {1} (HTTP {2})." -f $Name, $Url, $result.status) 'OK'
            return
        }
        Start-Sleep -Seconds 3
    }
    throw "Timed out waiting for $Name at $Url."
}

function Wait-ForPostgres {
    $envMap = Read-EnvFile -Path $script:EnvFile
    $user = Get-EnvValue -Map $envMap -Key 'POSTGRES_USER' -Default 'feedfactory'
    $db = Get-EnvValue -Map $envMap -Key 'POSTGRES_DB' -Default 'feed_factory_db'
    $deadline = (Get-Date).AddSeconds([int]$script:Options.TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $id = Get-ComposeContainerId -Service 'postgres'
        if ($id) {
            $probe = Invoke-Native -FilePath 'docker' -Arguments @('exec', $id, 'pg_isready', '-U', $user, '-d', $db) -AllowFailure -Quiet
            if ($probe.ExitCode -eq 0) {
                Write-Log 'PostgreSQL is ready.' 'OK'
                return
            }
        }
        Start-Sleep -Seconds 3
    }
    throw 'Timed out waiting for PostgreSQL readiness.'
}

function Assert-HealthySnapshot {
    param([System.Collections.IDictionary]$Snapshot)

    $current = $Snapshot
    $deadline = (Get-Date).AddSeconds([int]$script:Options.HealthGraceSeconds)

    while ($true) {
        $badServices = @($current.services | Where-Object { $_.state -ne 'running' -or ($_.health -notin @('healthy', 'none')) })
        $badEndpoints = @($current.endpoints | Where-Object { -not $_.ok })

        if ($badServices.Count -eq 0 -and $badEndpoints.Count -eq 0) {
            return
        }

        $onlyWaitingForDockerHealth = $badEndpoints.Count -eq 0 -and $badServices.Count -gt 0 -and @($badServices | Where-Object { $_.state -ne 'running' -or $_.health -ne 'starting' }).Count -eq 0
        if ($onlyWaitingForDockerHealth -and (Get-Date) -lt $deadline) {
            # HTTP readiness can be true before Docker's interval-based healthcheck flips to healthy.
            Write-Log ("Docker health is still starting after HTTP readiness; waiting up to {0}s for healthcheck convergence." -f $script:Options.HealthGraceSeconds) 'WARN'
            Start-Sleep -Seconds 5
            $current = Get-StatusSnapshot
            Save-StatusSnapshot -Snapshot $current
            continue
        }

        Add-RuntimeFailureDiagnostics -Snapshot $current -BadServices $badServices -BadEndpoints $badEndpoints
        $issueSummary = Format-RuntimeIssues -BadServices $badServices -BadEndpoints $badEndpoints
        throw ("Runtime health verification failed: {0}. Review the log tail in the official log file." -f ($issueSummary -join '; '))
    }
}

function Format-RuntimeIssues {
    param(
        [array]$BadServices,
        [array]$BadEndpoints
    )

    $issues = @()
    foreach ($service in $BadServices) {
        $issues += ("service {0} state={1} health={2} restarts={3}" -f $service.service, $service.state, $service.health, $service.restartCount)
    }
    foreach ($endpoint in $BadEndpoints) {
        $endpointError = ''
        if ($endpoint.Contains('error')) { $endpointError = [string]$endpoint['error'] }
        $detail = if ($endpointError) { $endpointError } else { "HTTP " + $endpoint.status }
        $issues += ("endpoint {0} failed ({1})" -f $endpoint.name, $detail)
    }
    if ($issues.Count -eq 0) { return @('unknown runtime health issue') }
    return $issues
}

function Add-RuntimeFailureDiagnostics {
    param(
        [System.Collections.IDictionary]$Snapshot,
        [array]$BadServices,
        [array]$BadEndpoints
    )

    Add-Content -Path $script:LogPath -Value '===== runtime health failure summary =====' -Encoding UTF8
    foreach ($line in (Format-RuntimeIssues -BadServices $BadServices -BadEndpoints $BadEndpoints)) {
        Add-Content -Path $script:LogPath -Value $line -Encoding UTF8
    }

    foreach ($service in $BadServices) {
        $id = Get-ComposeContainerId -Service $service.service
        if (-not $id) { continue }
        $inspect = Invoke-Native -FilePath 'docker' -Arguments @('inspect', $id) -AllowFailure -Quiet
        Add-Content -Path $script:LogPath -Value ("===== docker inspect health: {0} =====" -f $service.service) -Encoding UTF8
        Add-Content -Path $script:LogPath -Value $inspect.Output -Encoding UTF8
    }

    $tail = Invoke-Compose -Arguments @('logs', '--tail', '160') -AllowFailure -Quiet
    Add-Content -Path $script:LogPath -Value '===== docker compose logs tail =====' -Encoding UTF8
    Add-Content -Path $script:LogPath -Value $tail.Output -Encoding UTF8
}

function Print-RecentLogs {
    Section 'RECENT LOGS'
    Invoke-Compose -Arguments @('logs', '--tail', '250') | Out-Null
}

function Run-StatusOnly {
    $snapshot = Get-StatusSnapshot
    Save-StatusSnapshot -Snapshot $snapshot
    Show-Dashboard -Snapshot $snapshot
    Write-Host ''
    Write-Host ('Latest status JSON: {0}' -f $script:LatestStatusPath) -ForegroundColor Green
}

function Stop-OfficialStack {
    Section 'STOP'
    Invoke-Preflight
    if ($script:Options.Clean) {
        Invoke-Compose -Arguments @('down', '--remove-orphans') | Out-Null
        Write-Log 'Official stack is down. Volumes were kept.' 'OK'
    } else {
        Invoke-Compose -Arguments @('stop') | Out-Null
        Write-Log 'Official stack stopped. Containers and volumes were kept.' 'OK'
    }
}

function Run-Doctor {
    Invoke-Preflight
    Ensure-OfficialEnv
    Section 'COMPOSE CONFIG'
    $env:COMPOSE_BAKE = 'false'
    $env:DOCKER_BUILDKIT = '1'
    Invoke-Compose -Arguments @('config', '--quiet') | Out-Null
    Write-Log 'Docker compose configuration is valid.' 'OK'
}

function Start-OfficialStack {
    Invoke-Preflight
    Ensure-OfficialEnv

    Section 'COMPOSE CONFIG'
    $env:COMPOSE_BAKE = 'false'
    $env:DOCKER_BUILDKIT = '1'
    Invoke-Compose -Arguments @('config', '--quiet') | Out-Null
    Write-Log 'Docker compose configuration is valid.' 'OK'

    if ($script:Options.Pull) {
        Section 'PULL'
        Invoke-Compose -Arguments @('pull', 'postgres') | Out-Null
    }

    Section 'STARTUP'
    $upArgs = @('up', '-d', '--remove-orphans')
    if ($script:Options.Build) { $upArgs += '--build' }
    Invoke-Compose -Arguments $upArgs | Out-Null

    Section 'READINESS'
    Wait-ForPostgres
    Wait-ForServiceHttp -Name 'backend-health' -Url $script:BackendHealthUrl
    Wait-ForServiceHttp -Name 'frontend' -Url $script:FrontendUrl
    Wait-ForServiceHttp -Name 'frontend-api-proxy' -Url $script:ProxyHealthUrl
    Wait-ForServiceHttp -Name 'metrics' -Url $script:MetricsUrl -Headers (Get-MetricsHeaders)

    $snapshot = Get-StatusSnapshot
    Save-StatusSnapshot -Snapshot $snapshot
    Assert-HealthySnapshot -Snapshot $snapshot
    $snapshot = Get-StatusSnapshot
    Save-StatusSnapshot -Snapshot $snapshot

    Section 'READY'
    Write-Log ('Frontend URL: {0}' -f $script:FrontendUrl) 'OK'
    Write-Log ('Backend health: {0}' -f $script:BackendHealthUrl) 'OK'
    Write-Log ('Latest status JSON: {0}' -f $script:LatestStatusPath) 'OK'
    Write-Log ('Health stream: {0}' -f $script:HealthJsonl) 'OK'

    if ($script:Options.OpenBrowser) {
        Start-Process $script:FrontendUrl | Out-Null
        Write-Log 'Opened frontend in the default browser.' 'OK'
    }

    if ($script:Options.Monitor) {
        while ($true) {
            $liveSnapshot = Get-StatusSnapshot
            Save-StatusSnapshot -Snapshot $liveSnapshot
            Show-Dashboard -Snapshot $liveSnapshot
            Start-Sleep -Seconds ([int]$script:Options.MonitorIntervalSeconds)
        }
    } else {
        Show-Dashboard -Snapshot $snapshot
    }
}

Ensure-Directory -Path $script:LogsDir
Ensure-Directory -Path $script:TempDir
Set-Content -Path $script:LogPath -Value '' -Encoding UTF8
Initialize-Options

try {
    if ($script:Options.Help) { Show-Help; exit 0 }
    if ($script:Options.Logs) { Print-RecentLogs; exit 0 }
    if ($script:Options.Status) { Run-StatusOnly; exit 0 }
    if ($script:Options.Stop -or $script:Options.Clean) { Stop-OfficialStack; exit 0 }
    if ($script:Options.Doctor) { Run-Doctor; exit 0 }

    Start-OfficialStack
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    Write-Host ''
    Write-Host 'Diagnostics:' -ForegroundColor Yellow
    Write-Host ('  Main log       : {0}' -f $script:LogPath)
    Write-Host ('  Latest status  : {0}' -f $script:LatestStatusPath)
    Write-Host ('  Compose logs   : START_MZS_ERP_OFFICIAL.bat /logs')
    exit 1
}