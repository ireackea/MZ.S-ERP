param(
    [string]$RepoPath = $PSScriptRoot,
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$OpenBrowser,
    [switch]$SafeMode,
    [switch]$AutoRestart,
    [int]$RestartLimit = 3,
    [int]$HealthTimeoutSeconds = 120,
    [switch]$NoColor
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ShellExecutable {
    $pwshPath = Join-Path $PSHOME 'pwsh.exe'
    if (Test-Path $pwshPath) {
        return $pwshPath
    }

    $powershellPath = Join-Path $PSHOME 'powershell.exe'
    if (Test-Path $powershellPath) {
        return $powershellPath
    }

    return 'powershell.exe'
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR', 'OK')]
        [string]$Level = 'INFO'
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = '[{0}][{1}] {2}' -f $timestamp, $Level, $Message
    Add-Content -Path $script:MainLog -Value $line -Encoding UTF8

    if ($NoColor) {
        Write-Host $line
        return
    }

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

function Fail {
    param([string]$Message)
    throw $Message
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NodeVersionMajor {
    $nodeVersion = (& node -v).Trim()
    if ($nodeVersion -notmatch '^v(?<major>\d+)') {
        Fail ("Unable to parse Node.js version: {0}" -f $nodeVersion)
    }

    return [int]$Matches['major']
}

function Read-EnvFile {
    param([string]$Path)

    $map = [ordered]@{}
    if (-not (Test-Path $Path)) {
        return $map
    }

    foreach ($rawLine in Get-Content -Path $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#') -or -not $rawLine.Contains('=')) {
            continue
        }

        $parts = $rawLine -split '=', 2
        if ($parts.Count -ne 2) {
            continue
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key) {
            $map[$key] = $value
        }
    }

    return $map
}

function Ensure-EnvFile {
    param(
        [string]$Path,
        [string]$ExamplePath,
        [string]$FallbackPath = ''
    )

    if (Test-Path $Path) {
        return
    }

    if ($ExamplePath -and (Test-Path $ExamplePath)) {
        Copy-Item -Path $ExamplePath -Destination $Path -Force
        Write-Log ("Created env file from example: {0}" -f $Path) 'OK'
        return
    }

    if ($FallbackPath -and (Test-Path $FallbackPath)) {
        Copy-Item -Path $FallbackPath -Destination $Path -Force
        Write-Log ("Created env file from fallback: {0}" -f $Path) 'OK'
        return
    }

    Fail ("Missing environment source for {0}" -f $Path)
}

function Set-OrAppendEnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $replacement = '{0}={1}' -f $Key, $Value
    $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='

    if (-not (Test-Path $Path)) {
        Set-Content -Path $Path -Value $replacement -Encoding UTF8
        return
    }

    $content = Get-Content -Path $Path
    $updated = $false
    $newContent = foreach ($line in $content) {
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
        Add-Content -Path $Path -Value '' -Encoding UTF8
        Add-Content -Path $Path -Value $replacement -Encoding UTF8
    }
}

function New-SecureToken {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }

    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Test-PlaceholderValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }

    return $Value -match '^CHANGE_THIS' -or $Value -match '^<[^>]+>$'
}

function New-StrongAdminPassword {
    return ('Aa1!' + (New-SecureToken -Bytes 16))
}

function Ensure-EnvSecret {
    param(
        [string]$Path,
        [string]$Key,
        [int]$MinimumLength
    )

    $envMap = Read-EnvFile -Path $Path
    $currentValue = ''
    if ($envMap.Contains($Key)) {
        $currentValue = [string]$envMap[$Key]
    }

    if ((-not (Test-PlaceholderValue -Value $currentValue)) -and $currentValue.Length -ge $MinimumLength) {
        return $currentValue
    }

    $newValue = New-SecureToken -Bytes ([Math]::Max([Math]::Ceiling($MinimumLength / 2), 16))
    Set-OrAppendEnvValue -Path $Path -Key $Key -Value $newValue
    Write-Log ("Generated secure value for {0} in {1}" -f $Key, $Path) 'OK'
    return $newValue
}

function Get-EnvValue {
    param(
        [System.Collections.IDictionary]$Map,
        [string]$Key,
        [string]$DefaultValue = ''
    )

    if ($Map.Contains($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Map[$Key])) {
        return [string]$Map[$Key]
    }

    return $DefaultValue
}

function Read-PortFromEnv {
    param(
        [System.Collections.IDictionary]$Map,
        [string]$DefaultValue
    )

    foreach ($key in @('PORT', 'VITE_PORT')) {
        if ($Map.Contains($key) -and [string]$Map[$key] -match '^\d+$') {
            return [int]$Map[$key]
        }
    }

    return [int]$DefaultValue
}

function Merge-CorsOrigins {
    param(
        [string]$RawOrigins,
        [string[]]$RequiredOrigins
    )

    $orderedOrigins = New-Object System.Collections.Specialized.OrderedDictionary
    $candidates = @()

    if (-not [string]::IsNullOrWhiteSpace($RawOrigins)) {
        $candidates += ($RawOrigins -split ',')
    }
    $candidates += $RequiredOrigins

    foreach ($candidate in $candidates) {
        $origin = [string]$candidate
        if ([string]::IsNullOrWhiteSpace($origin)) {
            continue
        }

        $normalizedOrigin = $origin.Trim().TrimEnd('/')
        if (-not $normalizedOrigin) {
            continue
        }

        $key = $normalizedOrigin.ToLowerInvariant()
        if (-not $orderedOrigins.Contains($key)) {
            $orderedOrigins.Add($key, $normalizedOrigin)
        }
    }

    return (($orderedOrigins.Values | ForEach-Object { [string]$_ }) -join ',')
}

function Normalize-PostgresUrlForLocalRuntime {
    param([string]$ConnectionString)

    if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
        return $ConnectionString
    }

    if ($ConnectionString -notmatch '^postgres(?:ql)?://') {
        return $ConnectionString
    }

    $uri = [System.Uri]$ConnectionString
    if ($uri.Host -eq 'localhost' -or $uri.Host -eq '127.0.0.1') {
        return $ConnectionString
    }

    if ($uri.Host -eq 'postgres') {
        $builder = New-Object System.UriBuilder($uri)
        $builder.Host = 'localhost'
        return $builder.Uri.OriginalString.TrimEnd('/')
    }

    return $ConnectionString
}

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutMs = 1200
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-PostgresEndpoint {
    param([string]$ConnectionString)

    if ([string]::IsNullOrWhiteSpace($ConnectionString) -or $ConnectionString -notmatch '^postgres(?:ql)?://') {
        return $null
    }

    $uri = [System.Uri]$ConnectionString
    return [pscustomobject]@{
        Host = $uri.Host
        Port = $(if ($uri.Port -gt 0) { $uri.Port } else { 5432 })
    }
}

function Invoke-LoggedCommand {
    param(
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$Arguments,
        [hashtable]$Environment = @{},
        [string]$FailureMessage,
        [switch]$AllowFailure
    )

    Write-Log ("Running command: {0} {1}" -f $FilePath, ($Arguments -join ' '))

    $backup = @{}
    $outputLines = @()
    $previousErrorActionPreference = $ErrorActionPreference
    $nativePreferenceSupported = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $previousNativePreference = $null

    if ($nativePreferenceSupported) {
        $previousNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }

    $ErrorActionPreference = 'Continue'
    foreach ($entry in $Environment.GetEnumerator()) {
        $backup[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
    }

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $script:MainLog -Append | ForEach-Object {
            $outputLines += [string]$_
        }

        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0 -and -not $AllowFailure) {
            Fail $FailureMessage
        }

        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = ($outputLines -join [Environment]::NewLine)
        }
    } finally {
        Pop-Location
        $ErrorActionPreference = $previousErrorActionPreference
        if ($nativePreferenceSupported) {
            $PSNativeCommandUseErrorActionPreference = $previousNativePreference
        }
        foreach ($entry in $backup.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
    }
}

function Stop-ProcessIfRunning {
    param([int]$ProcessId)

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        # no-op
    }
}

function Stop-TrackedProcesses {
    param([string]$StatePath)

    if (-not (Test-Path $StatePath)) {
        return
    }

    try {
        $state = Get-Content -Path $StatePath -Raw | ConvertFrom-Json
        foreach ($field in @('backendPid', 'frontendPid')) {
            if ($state.$field) {
                Stop-ProcessIfRunning -ProcessId ([int]$state.$field)
            }
        }
    } catch {
        Write-Log ("Unable to parse existing state file: {0}" -f $StatePath) 'WARN'
    }
}

function Get-ListeningProcessIds {
    param([int[]]$Ports)

    $ids = New-Object System.Collections.Generic.HashSet[int]
    foreach ($port in $Ports) {
        $matches = netstat -ano | Select-String (":{0}\s" -f $port)
        foreach ($match in $matches) {
            $parts = ($match.Line -split '\s+') | Where-Object { $_ }
            if ($parts.Count -lt 5) {
                continue
            }

            $state = $parts[3]
            $processId = 0
            if ($state -ne 'LISTENING') {
                continue
            }

            if (-not [int]::TryParse($parts[-1], [ref]$processId)) {
                continue
            }

            [void]$ids.Add($processId)
        }
    }

    return @($ids.GetEnumerator() | ForEach-Object { [int]$_ })
}

function Stop-ProcessesOnManagedPorts {
    foreach ($processId in (Get-ListeningProcessIds -Ports @($script:BackendPort, $script:FrontendPort, $script:PreviewPort))) {
        Stop-ProcessIfRunning -ProcessId $processId
    }
}

function Convert-EnvMapToAssignments {
    param([hashtable]$Environment)

    $assignments = foreach ($entry in $Environment.GetEnumerator()) {
        '$env:' + $entry.Key + " = '" + ([string]$entry.Value).Replace("'", "''") + "'"
    }

    return ($assignments -join '; ')
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$CommandLine,
        [string]$LogFile,
        [hashtable]$Environment
    )

    $shellExecutable = Get-ShellExecutable
    $envAssignments = Convert-EnvMapToAssignments -Environment $Environment
    $quotedWorkingDir = $WorkingDirectory.Replace("'", "''")
    $quotedLogFile = $LogFile.Replace("'", "''")
    $utf8Bootstrap = @(
        "`$ErrorActionPreference = 'Continue'",
        "if (Test-Path variable:PSNativeCommandUseErrorActionPreference) { `$PSNativeCommandUseErrorActionPreference = `$false }",
        "`$utf8NoBom = [System.Text.UTF8Encoding]::new(`$false)",
        "`$OutputEncoding = `$utf8NoBom",
        "[Console]::InputEncoding = `$utf8NoBom",
        "[Console]::OutputEncoding = `$utf8NoBom"
    ) -join '; '
    $commandText = "& {{ {0}; Set-Location -LiteralPath '{1}'; {2}; {3} *>> '{4}' }}" -f $utf8Bootstrap, $quotedWorkingDir, $envAssignments, $CommandLine, $quotedLogFile

    Write-Log ("Starting {0}: {1}" -f $Name, $CommandLine)
    $process = Start-Process -FilePath $shellExecutable -PassThru -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', $commandText
    )

    return $process
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$Lines = 20
    )

    if (-not (Test-Path $Path)) {
        return ''
    }

    return ((Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue) -join [Environment]::NewLine)
}

function Wait-ForBackendHealth {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Url,
        [string]$LogFile,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            Fail ("Backend exited unexpectedly.{0}{1}" -f [Environment]::NewLine, (Get-LogTail -Path $LogFile))
        }

        try {
            $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5
            if ($response.status -in @('healthy', 'degraded')) {
                Write-Log ("Backend health check passed at {0}" -f $Url) 'OK'
                return
            }
        } catch {
            Start-Sleep -Seconds 2
            continue
        }

        Start-Sleep -Seconds 2
    }

    Fail ("Backend health check timed out at {0}.{1}{2}" -f $Url, [Environment]::NewLine, (Get-LogTail -Path $LogFile))
}

function Wait-ForFrontend {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Url,
        [string]$LogFile,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            Fail ("Frontend exited unexpectedly.{0}{1}" -f [Environment]::NewLine, (Get-LogTail -Path $LogFile))
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Log ("Frontend check passed at {0}" -f $Url) 'OK'
                return
            }
        } catch {
            Start-Sleep -Seconds 2
            continue
        }

        Start-Sleep -Seconds 2
    }

    Fail ("Frontend check timed out at {0}.{1}{2}" -f $Url, [Environment]::NewLine, (Get-LogTail -Path $LogFile))
}

function Wait-ForMetrics {
    param(
        [string]$Url,
        [string]$Token,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $headers = @{}
            if ($Token) {
                $headers['x-metrics-token'] = $Token
            }
            $response = Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200 -and $response.Content.Length -gt 0) {
                Write-Log ("Metrics check passed at {0}" -f $Url) 'OK'
                return
            }
        } catch {
            Start-Sleep -Seconds 2
            continue
        }

        Start-Sleep -Seconds 2
    }

    Write-Log ("Metrics endpoint did not become ready at {0}" -f $Url) 'WARN'
}

function Ensure-PostgresReady {
    param([string]$ConnectionString)

    $endpoint = Get-PostgresEndpoint -ConnectionString $ConnectionString
    if ($null -eq $endpoint) {
        return
    }

    if (Test-TcpPort -HostName $endpoint.Host -Port $endpoint.Port) {
        Write-Log ("Database port is reachable at {0}:{1}" -f $endpoint.Host, $endpoint.Port) 'OK'
        return
    }

    if (-not (Test-Command 'docker')) {
        Fail ("Database is not reachable at {0}:{1} and Docker is unavailable." -f $endpoint.Host, $endpoint.Port)
    }

    Write-Log 'Database port is down. Attempting to start docker compose postgres service.' 'WARN'
    Invoke-LoggedCommand -WorkingDirectory $script:RootPath -FilePath 'docker' -Arguments @('compose', '-f', 'docker-compose.yml', 'up', '-d', 'postgres') -FailureMessage 'Failed to start postgres service via docker compose.'

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort -HostName $endpoint.Host -Port $endpoint.Port) {
            Write-Log ("Database became reachable at {0}:{1}" -f $endpoint.Host, $endpoint.Port) 'OK'
            return
        }
        Start-Sleep -Seconds 2
    }

    Fail ("Database is still unreachable at {0}:{1} after docker startup." -f $endpoint.Host, $endpoint.Port)
}

function Write-StateFile {
    param(
        [string]$Path,
        [hashtable]$Payload
    )

    $json = $Payload | ConvertTo-Json -Depth 6
    Set-Content -Path $Path -Value $json -Encoding UTF8
}

function Build-RuntimeEnvironment {
    param(
        [System.Collections.IDictionary]$RootEnv,
        [System.Collections.IDictionary]$BackendEnv,
        [System.Collections.IDictionary]$FrontendEnv
    )

    $runtimeDatabaseUrl = Normalize-PostgresUrlForLocalRuntime -ConnectionString (Get-EnvValue -Map $BackendEnv -Key 'DATABASE_URL' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'DATABASE_URL'))
    $runtimeDatabaseDirectUrl = Normalize-PostgresUrlForLocalRuntime -ConnectionString (Get-EnvValue -Map $BackendEnv -Key 'DATABASE_DIRECT_URL' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'DATABASE_DIRECT_URL' -DefaultValue $runtimeDatabaseUrl))
    $jwtSecret = Get-EnvValue -Map $BackendEnv -Key 'JWT_SECRET' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'JWT_SECRET')
    $backupSecret = Get-EnvValue -Map $BackendEnv -Key 'BACKUP_ENCRYPTION_SECRET' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'BACKUP_ENCRYPTION_SECRET')
    $systemResetToken = Get-EnvValue -Map $BackendEnv -Key 'SYSTEM_RESET_TOKEN' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'SYSTEM_RESET_TOKEN')
    $metricsToken = Get-EnvValue -Map $BackendEnv -Key 'METRICS_AUTH_TOKEN' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'METRICS_AUTH_TOKEN')
    $requiredCorsOrigins = @(
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:4173',
        'http://127.0.0.1:3000'
    )
    $corsOrigins = Merge-CorsOrigins -RawOrigins (Get-EnvValue -Map $BackendEnv -Key 'CORS_ORIGINS' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'CORS_ORIGINS')) -RequiredOrigins $requiredCorsOrigins
    $allowCodespaces = Get-EnvValue -Map $BackendEnv -Key 'ALLOW_CODESPACES_ORIGINS' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'ALLOW_CODESPACES_ORIGINS' -DefaultValue 'false')
    $adminPassword = Get-EnvValue -Map $BackendEnv -Key 'ADMIN_PASSWORD' -DefaultValue (Get-EnvValue -Map $RootEnv -Key 'ADMIN_PASSWORD')
    $frontendApiUrl = Get-EnvValue -Map $FrontendEnv -Key 'VITE_API_URL' -DefaultValue 'http://localhost:3001'
    $frontendBackendOrigin = Get-EnvValue -Map $FrontendEnv -Key 'VITE_BACKEND_ORIGIN' -DefaultValue 'http://localhost:3001'
    $nodeEnvironment = if ($SafeMode) { 'production' } else { 'development' }

    return [ordered]@{
        DATABASE_URL = $runtimeDatabaseUrl
        DATABASE_DIRECT_URL = $runtimeDatabaseDirectUrl
        JWT_SECRET = $jwtSecret
        BACKUP_ENCRYPTION_SECRET = $backupSecret
        SYSTEM_RESET_TOKEN = $systemResetToken
        METRICS_AUTH_TOKEN = $metricsToken
        CORS_ORIGINS = $corsOrigins
        ALLOW_CODESPACES_ORIGINS = $allowCodespaces
        ADMIN_PASSWORD = $adminPassword
        PORT = [string]$script:BackendPort
        NODE_ENV = $nodeEnvironment
        VITE_BACKEND_ORIGIN = $frontendBackendOrigin
        VITE_API_URL = $(if ($SafeMode) { $frontendApiUrl } else { '' })
    }
}

function Sync-EnvironmentFiles {
    Ensure-EnvFile -Path $script:RootEnvPath -ExamplePath $script:RootEnvExamplePath
    Ensure-EnvFile -Path $script:BackendEnvPath -ExamplePath $script:BackendEnvExamplePath -FallbackPath $script:RootEnvPath
    Ensure-EnvFile -Path $script:FrontendEnvPath -ExamplePath $script:FrontendEnvExamplePath

    [void](Ensure-EnvSecret -Path $script:RootEnvPath -Key 'BACKUP_ENCRYPTION_SECRET' -MinimumLength 32)
    [void](Ensure-EnvSecret -Path $script:RootEnvPath -Key 'SYSTEM_RESET_TOKEN' -MinimumLength 16)
    [void](Ensure-EnvSecret -Path $script:RootEnvPath -Key 'METRICS_AUTH_TOKEN' -MinimumLength 32)

    $rootEnv = Read-EnvFile -Path $script:RootEnvPath
    if (Test-PlaceholderValue -Value (Get-EnvValue -Map $rootEnv -Key 'JWT_SECRET')) {
        Set-OrAppendEnvValue -Path $script:RootEnvPath -Key 'JWT_SECRET' -Value (New-SecureToken -Bytes 32)
        Write-Log ("Generated JWT_SECRET in {0}" -f $script:RootEnvPath) 'OK'
        $rootEnv = Read-EnvFile -Path $script:RootEnvPath
    }

    if (Test-PlaceholderValue -Value (Get-EnvValue -Map $rootEnv -Key 'ADMIN_PASSWORD')) {
        Set-OrAppendEnvValue -Path $script:RootEnvPath -Key 'ADMIN_PASSWORD' -Value (New-StrongAdminPassword)
        Write-Log ("Generated ADMIN_PASSWORD in {0}" -f $script:RootEnvPath) 'OK'
        $rootEnv = Read-EnvFile -Path $script:RootEnvPath
    }

    $normalizedCorsOrigins = Merge-CorsOrigins -RawOrigins (Get-EnvValue -Map $rootEnv -Key 'CORS_ORIGINS') -RequiredOrigins @(
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:4173',
        'http://127.0.0.1:3000'
    )
    Set-OrAppendEnvValue -Path $script:RootEnvPath -Key 'CORS_ORIGINS' -Value $normalizedCorsOrigins
    $rootEnv = Read-EnvFile -Path $script:RootEnvPath

    $localDatabaseUrl = Normalize-PostgresUrlForLocalRuntime -ConnectionString (Get-EnvValue -Map $rootEnv -Key 'DATABASE_URL')
    $localDatabaseDirectUrl = Normalize-PostgresUrlForLocalRuntime -ConnectionString (Get-EnvValue -Map $rootEnv -Key 'DATABASE_DIRECT_URL' -DefaultValue $localDatabaseUrl)

    foreach ($entry in @(
        @{ Key = 'DATABASE_URL'; Value = $localDatabaseUrl },
        @{ Key = 'DATABASE_DIRECT_URL'; Value = $localDatabaseDirectUrl },
        @{ Key = 'JWT_SECRET'; Value = (Get-EnvValue -Map $rootEnv -Key 'JWT_SECRET') },
        @{ Key = 'BACKUP_ENCRYPTION_SECRET'; Value = (Get-EnvValue -Map $rootEnv -Key 'BACKUP_ENCRYPTION_SECRET') },
        @{ Key = 'SYSTEM_RESET_TOKEN'; Value = (Get-EnvValue -Map $rootEnv -Key 'SYSTEM_RESET_TOKEN') },
        @{ Key = 'METRICS_AUTH_TOKEN'; Value = (Get-EnvValue -Map $rootEnv -Key 'METRICS_AUTH_TOKEN') },
        @{ Key = 'ADMIN_PASSWORD'; Value = (Get-EnvValue -Map $rootEnv -Key 'ADMIN_PASSWORD') },
        @{ Key = 'CORS_ORIGINS'; Value = $normalizedCorsOrigins },
        @{ Key = 'ALLOW_CODESPACES_ORIGINS'; Value = (Get-EnvValue -Map $rootEnv -Key 'ALLOW_CODESPACES_ORIGINS' -DefaultValue 'false') },
        @{ Key = 'PORT'; Value = [string]$script:BackendPort },
        @{ Key = 'NODE_ENV'; Value = $(if ($SafeMode) { 'production' } else { 'development' }) }
    )) {
        Set-OrAppendEnvValue -Path $script:BackendEnvPath -Key $entry.Key -Value $entry.Value
    }

    foreach ($entry in @(
        @{ Key = 'VITE_BACKEND_ORIGIN'; Value = 'http://localhost:3001' },
        @{ Key = 'VITE_API_URL'; Value = 'http://localhost:3001' }
    )) {
        Set-OrAppendEnvValue -Path $script:FrontendEnvPath -Key $entry.Key -Value $entry.Value
    }

    return [ordered]@{
        Root = (Read-EnvFile -Path $script:RootEnvPath)
        Backend = (Read-EnvFile -Path $script:BackendEnvPath)
        Frontend = (Read-EnvFile -Path $script:FrontendEnvPath)
    }
}

function Start-ComponentBundle {
    param([hashtable]$RuntimeEnvironment)

    $backendCommand = if ($SafeMode) { 'npm run start:prod' } else { 'npm run start:dev' }
    $frontendCommand = if ($SafeMode) {
        'npm run preview -- --host 0.0.0.0 --port ' + $script:PreviewPort
    } else {
        'npm run dev -- --host 0.0.0.0 --port ' + $script:FrontendPort
    }

    $backendEnvironment = [ordered]@{}
    foreach ($key in @('DATABASE_URL', 'DATABASE_DIRECT_URL', 'JWT_SECRET', 'BACKUP_ENCRYPTION_SECRET', 'SYSTEM_RESET_TOKEN', 'METRICS_AUTH_TOKEN', 'CORS_ORIGINS', 'ALLOW_CODESPACES_ORIGINS', 'ADMIN_PASSWORD', 'NODE_ENV', 'PORT')) {
        $backendEnvironment[$key] = $RuntimeEnvironment[$key]
    }

    $frontendEnvironment = [ordered]@{}
    foreach ($key in @('NODE_ENV', 'VITE_BACKEND_ORIGIN')) {
        $frontendEnvironment[$key] = $RuntimeEnvironment[$key]
    }
    if ($SafeMode) {
        $frontendEnvironment['VITE_API_URL'] = $RuntimeEnvironment['VITE_API_URL']
    }

    $backendProcess = Start-ManagedProcess -Name 'backend' -WorkingDirectory $script:BackendDir -CommandLine $backendCommand -LogFile $script:BackendLog -Environment $backendEnvironment
    $script:StartedProcesses += $backendProcess.Id
    Wait-ForBackendHealth -Process $backendProcess -Url $script:BackendHealthUrl -LogFile $script:BackendLog -TimeoutSeconds $HealthTimeoutSeconds

    $frontendProcess = Start-ManagedProcess -Name 'frontend' -WorkingDirectory $script:FrontendDir -CommandLine $frontendCommand -LogFile $script:FrontendLog -Environment $frontendEnvironment
    $script:StartedProcesses += $frontendProcess.Id
    $frontendUrl = if ($SafeMode) { $script:PreviewUrl } else { $script:FrontendUrl }
    Wait-ForFrontend -Process $frontendProcess -Url $frontendUrl -LogFile $script:FrontendLog -TimeoutSeconds $HealthTimeoutSeconds
    Wait-ForMetrics -Url $script:MetricsUrl -Token $RuntimeEnvironment['METRICS_AUTH_TOKEN'] -TimeoutSeconds 20

    $statePayload = [ordered]@{
        timestamp = $script:Timestamp
        repoPath = $script:RootPath
        safeMode = [bool]$SafeMode
        backendPid = $backendProcess.Id
        frontendPid = $frontendProcess.Id
        backendPort = $script:BackendPort
        frontendPort = $(if ($SafeMode) { $script:PreviewPort } else { $script:FrontendPort })
        backendUrl = $script:BackendUrl
        frontendUrl = $frontendUrl
        healthUrl = $script:BackendHealthUrl
        metricsUrl = $script:MetricsUrl
        mainLog = $script:MainLog
        backendLog = $script:BackendLog
        frontendLog = $script:FrontendLog
    }

    Write-StateFile -Path $script:StateFile -Payload $statePayload
    Write-StateFile -Path $script:ActiveStateFile -Payload $statePayload

    Write-Log ("Backend PID: {0}" -f $backendProcess.Id) 'OK'
    Write-Log ("Frontend PID: {0}" -f $frontendProcess.Id) 'OK'
    Write-Log ("Backend URL: {0}" -f $script:BackendUrl) 'OK'
    Write-Log ("Frontend URL: {0}" -f $frontendUrl) 'OK'
    Write-Log ("Health URL: {0}" -f $script:BackendHealthUrl) 'OK'
    Write-Log ("Metrics URL: {0}" -f $script:MetricsUrl) 'OK'

    if ($OpenBrowser) {
        Start-Process $frontendUrl | Out-Null
        Write-Log 'Opened browser.' 'OK'
    }

    return [ordered]@{
        BackendProcess = $backendProcess
        FrontendProcess = $frontendProcess
        BackendEnvironment = $backendEnvironment
        FrontendEnvironment = $frontendEnvironment
        FrontendUrl = $frontendUrl
    }
}

function Watch-Processes {
    param([hashtable]$Bundle)

    $restartCounts = @{
        backend = 0
        frontend = 0
    }

    while ($true) {
        Start-Sleep -Seconds 2

        if ($Bundle.BackendProcess.HasExited) {
            $restartCounts['backend'] += 1
            if ($restartCounts['backend'] -gt $RestartLimit) {
                Fail ("Backend exceeded restart limit. Tail:{0}{1}" -f [Environment]::NewLine, (Get-LogTail -Path $script:BackendLog))
            }

            Write-Log ("Restarting backend (attempt {0}/{1})" -f $restartCounts['backend'], $RestartLimit) 'WARN'
            $Bundle.BackendProcess = Start-ManagedProcess -Name 'backend' -WorkingDirectory $script:BackendDir -CommandLine $(if ($SafeMode) { 'npm run start:prod' } else { 'npm run start:dev' }) -LogFile $script:BackendLog -Environment $Bundle.BackendEnvironment
            Wait-ForBackendHealth -Process $Bundle.BackendProcess -Url $script:BackendHealthUrl -LogFile $script:BackendLog -TimeoutSeconds $HealthTimeoutSeconds
        }

        if ($Bundle.FrontendProcess.HasExited) {
            $restartCounts['frontend'] += 1
            if ($restartCounts['frontend'] -gt $RestartLimit) {
                Fail ("Frontend exceeded restart limit. Tail:{0}{1}" -f [Environment]::NewLine, (Get-LogTail -Path $script:FrontendLog))
            }

            Write-Log ("Restarting frontend (attempt {0}/{1})" -f $restartCounts['frontend'], $RestartLimit) 'WARN'
            $frontendCommand = if ($SafeMode) {
                'npm run preview -- --host 0.0.0.0 --port ' + $script:PreviewPort
            } else {
                'npm run dev -- --host 0.0.0.0 --port ' + $script:FrontendPort
            }
            $Bundle.FrontendProcess = Start-ManagedProcess -Name 'frontend' -WorkingDirectory $script:FrontendDir -CommandLine $frontendCommand -LogFile $script:FrontendLog -Environment $Bundle.FrontendEnvironment
            Wait-ForFrontend -Process $Bundle.FrontendProcess -Url $Bundle.FrontendUrl -LogFile $script:FrontendLog -TimeoutSeconds $HealthTimeoutSeconds
        }

        $statePayload = [ordered]@{
            timestamp = $script:Timestamp
            repoPath = $script:RootPath
            safeMode = [bool]$SafeMode
            backendPid = $Bundle.BackendProcess.Id
            frontendPid = $Bundle.FrontendProcess.Id
            backendPort = $script:BackendPort
            frontendPort = $(if ($SafeMode) { $script:PreviewPort } else { $script:FrontendPort })
            backendUrl = $script:BackendUrl
            frontendUrl = $Bundle.FrontendUrl
            healthUrl = $script:BackendHealthUrl
            metricsUrl = $script:MetricsUrl
            mainLog = $script:MainLog
            backendLog = $script:BackendLog
            frontendLog = $script:FrontendLog
        }
        Write-StateFile -Path $script:ActiveStateFile -Payload $statePayload
    }
}

$resolvedRoot = Resolve-Path -Path $RepoPath
$script:RootPath = $resolvedRoot.Path
$script:BackendDir = Join-Path $script:RootPath 'backend'
$script:FrontendDir = Join-Path $script:RootPath 'frontend'
$script:LogsDir = Join-Path $script:RootPath 'logs'
$script:TempDir = Join-Path $script:RootPath 'temp'
$script:Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:MainLog = Join-Path $script:LogsDir ("start-{0}.log" -f $script:Timestamp)
$script:BackendLog = Join-Path $script:LogsDir ("backend-{0}.log" -f $script:Timestamp)
$script:FrontendLog = Join-Path $script:LogsDir ("frontend-{0}.log" -f $script:Timestamp)
$script:StateFile = Join-Path $script:TempDir ("processes-{0}.json" -f $script:Timestamp)
$script:ActiveStateFile = Join-Path $script:TempDir 'processes-active.json'
$script:RootEnvPath = Join-Path $script:RootPath '.env'
$script:RootEnvExamplePath = Join-Path $script:RootPath '.env.example'
$script:BackendEnvPath = Join-Path $script:BackendDir '.env'
$script:BackendEnvExamplePath = Join-Path $script:BackendDir '.env.example'
$script:FrontendEnvPath = Join-Path $script:FrontendDir '.env'
$script:FrontendEnvExamplePath = Join-Path $script:FrontendDir '.env.example'
$script:BackendPort = 3001
$script:FrontendPort = 5173
$script:PreviewPort = 4173
$script:BackendHealthUrl = 'http://localhost:3001/api/health'
$script:BackendUrl = 'http://localhost:3001'
$script:FrontendUrl = 'http://localhost:5173'
$script:PreviewUrl = 'http://localhost:4173'
$script:MetricsUrl = 'http://localhost:3001/metrics'
$script:StartedProcesses = @()

Ensure-Directory -Path $script:LogsDir
Ensure-Directory -Path $script:TempDir
Set-Content -Path $script:MainLog -Value '' -Encoding UTF8

try {
    Section 'PRE-FLIGHT'

    if (-not (Test-Path $script:BackendDir)) {
        Fail 'Missing backend directory.'
    }
    if (-not (Test-Path $script:FrontendDir)) {
        Fail 'Missing frontend directory.'
    }

    foreach ($tool in @('node', 'npm', 'git')) {
        if (-not (Test-Command $tool)) {
            Fail ("Required command is not available: {0}" -f $tool)
        }
    }

    $nodeVersionMajor = Get-NodeVersionMajor
    $nodeVersionText = (& node -v).Trim()
    Write-Log ("Node.js version: {0}" -f $nodeVersionText)
    if ($nodeVersionMajor -lt 18) {
        Fail 'Node.js 18 or newer is required.'
    }
    if ($nodeVersionMajor -lt 20) {
        Write-Log 'Node.js 20+ is strongly recommended for this workspace.' 'WARN'
    }

    Section 'ENVIRONMENT'
    $syncedEnv = Sync-EnvironmentFiles
    $script:BackendPort = Read-PortFromEnv -Map $syncedEnv.Backend -DefaultValue '3001'
    $script:FrontendPort = Read-PortFromEnv -Map $syncedEnv.Frontend -DefaultValue '5173'
    $script:BackendHealthUrl = 'http://localhost:{0}/api/health' -f $script:BackendPort
    $script:BackendUrl = 'http://localhost:{0}' -f $script:BackendPort
    $script:FrontendUrl = 'http://localhost:{0}' -f $script:FrontendPort
    $script:PreviewUrl = 'http://localhost:{0}' -f $script:PreviewPort
    $script:MetricsUrl = 'http://localhost:{0}/metrics' -f $script:BackendPort

    $runtimeEnvironment = Build-RuntimeEnvironment -RootEnv $syncedEnv.Root -BackendEnv $syncedEnv.Backend -FrontendEnv $syncedEnv.Frontend

    Section 'SECURITY CHECKS'
    if ([string]::IsNullOrWhiteSpace($runtimeEnvironment['JWT_SECRET'])) {
        Fail 'JWT_SECRET must not be empty.'
    }
    if ($SafeMode -and [string]$runtimeEnvironment['BACKUP_ENCRYPTION_SECRET'].Length -lt 32) {
        Fail 'BACKUP_ENCRYPTION_SECRET must be at least 32 characters in safe mode.'
    }
    if ($SafeMode -and [string]$runtimeEnvironment['SYSTEM_RESET_TOKEN'].Length -lt 16) {
        Fail 'SYSTEM_RESET_TOKEN must be at least 16 characters in safe mode.'
    }

    Section 'CLEAN SHUTDOWN'
    Stop-TrackedProcesses -StatePath $script:ActiveStateFile
    Stop-ProcessesOnManagedPorts

    Section 'DATABASE'
    Ensure-PostgresReady -ConnectionString $runtimeEnvironment['DATABASE_URL']

    if (-not $SkipInstall) {
        Section 'DEPENDENCIES'
        Invoke-LoggedCommand -WorkingDirectory $script:RootPath -FilePath 'npm' -Arguments @($(if (Test-Path (Join-Path $script:RootPath 'package-lock.json')) { 'ci' } else { 'install' })) -FailureMessage 'Root dependency installation failed.'
        Invoke-LoggedCommand -WorkingDirectory $script:BackendDir -FilePath 'npm' -Arguments @($(if (Test-Path (Join-Path $script:BackendDir 'package-lock.json')) { 'ci' } else { 'install' })) -FailureMessage 'Backend dependency installation failed.'
        Invoke-LoggedCommand -WorkingDirectory $script:FrontendDir -FilePath 'npm' -Arguments @($(if (Test-Path (Join-Path $script:FrontendDir 'package-lock.json')) { 'ci' } else { 'install' })) -FailureMessage 'Frontend dependency installation failed.'
    } else {
        Write-Log 'Skipping dependency installation by request.' 'WARN'
    }

    Section 'VALIDATION'
    $prismaValidation = Invoke-LoggedCommand -WorkingDirectory $script:BackendDir -FilePath 'npx' -Arguments @('prisma', 'validate', '--schema', 'prisma/schema.prisma') -Environment @{ 'DATABASE_URL' = $runtimeEnvironment['DATABASE_URL'] } -FailureMessage 'Prisma schema validation failed.' -AllowFailure
    if ($prismaValidation.ExitCode -ne 0) {
        if ($prismaValidation.Output -match 'The datasource property `url` is no longer supported') {
            Write-Log 'Skipping Prisma CLI validation and generation because the backend schema is still on legacy datasource syntax that Prisma 7 no longer validates directly.' 'WARN'
        } else {
            Fail 'Prisma schema validation failed.'
        }
    } else {
        $prismaGeneration = Invoke-LoggedCommand -WorkingDirectory $script:BackendDir -FilePath 'npx' -Arguments @('prisma', 'generate', '--schema', 'prisma/schema.prisma') -Environment @{ 'DATABASE_URL' = $runtimeEnvironment['DATABASE_URL'] } -FailureMessage 'Prisma client generation failed.' -AllowFailure
        if ($prismaGeneration.ExitCode -ne 0) {
            if ($prismaGeneration.Output -match 'The datasource property `url` is no longer supported') {
                Write-Log 'Skipping Prisma client generation because the backend currently depends on legacy Prisma datasource syntax.' 'WARN'
            } else {
                Fail 'Prisma client generation failed.'
            }
        }
    }

    if (-not $SkipBuild) {
        Section 'BUILD'
        $buildEnvironment = [ordered]@{
            DATABASE_URL = $runtimeEnvironment['DATABASE_URL']
            DATABASE_DIRECT_URL = $runtimeEnvironment['DATABASE_DIRECT_URL']
            JWT_SECRET = $runtimeEnvironment['JWT_SECRET']
            BACKUP_ENCRYPTION_SECRET = $runtimeEnvironment['BACKUP_ENCRYPTION_SECRET']
            SYSTEM_RESET_TOKEN = $runtimeEnvironment['SYSTEM_RESET_TOKEN']
            METRICS_AUTH_TOKEN = $runtimeEnvironment['METRICS_AUTH_TOKEN']
            PORT = [string]$script:BackendPort
            NODE_ENV = $(if ($SafeMode) { 'production' } else { 'development' })
            VITE_BACKEND_ORIGIN = $runtimeEnvironment['VITE_BACKEND_ORIGIN']
        }
        if ($SafeMode) {
            $buildEnvironment['VITE_API_URL'] = $runtimeEnvironment['VITE_API_URL']
        }
        Invoke-LoggedCommand -WorkingDirectory $script:RootPath -FilePath 'npm' -Arguments @('run', 'build:full') -Environment $buildEnvironment -FailureMessage 'Workspace build failed.'
    } else {
        Write-Log 'Skipping build by request.' 'WARN'
    }

    Section 'STARTUP'
    $bundle = Start-ComponentBundle -RuntimeEnvironment $runtimeEnvironment

    Section 'DONE'
    Write-Log ("Launcher completed successfully in {0} mode." -f $(if ($SafeMode) { 'safe' } else { 'development' })) 'OK'

    if ($AutoRestart) {
        Section 'AUTO RESTART'
        Write-Log ("Watching processes with restart limit {0}." -f $RestartLimit)
        Watch-Processes -Bundle $bundle
    }
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    foreach ($startedProcessId in $script:StartedProcesses) {
        Stop-ProcessIfRunning -ProcessId $startedProcessId
    }
    exit 1
}
