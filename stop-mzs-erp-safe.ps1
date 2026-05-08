param(
    [string]$RepoPath = $PSScriptRoot,
    [switch]$NoColor
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Status {
    param(
        [string]$Message,
        [string]$Color = 'Cyan'
    )

    if ($NoColor) {
        Write-Host $Message
        return
    }

    Write-Host $Message -ForegroundColor $Color
}

function Stop-ProcessIfRunning {
    param(
        [int]$ProcessId,
        [string]$Label,
        [string]$RootPath
    )

    try {
        $processInfo = Get-ManagedProcessInfo -ProcessId $ProcessId
        if (-not (Test-ProcessSafeToStop -ProcessInfo $processInfo -RootPath $RootPath)) {
            Write-Status ("[WARN] Skipped {0} PID {1} ({2}) because it is not a launcher-owned process: {3}" -f $Label, $ProcessId, $processInfo.ProcessName, $processInfo.Reason) 'Yellow'
            return $false
        }

        Stop-Process -Id $processInfo.Id -Force -ErrorAction Stop
        Write-Status ("[OK] Stopped {0} PID {1} ({2})" -f $Label, $processInfo.Id, $processInfo.ProcessName) 'Green'
        return $true
    } catch {
        Write-Status ("[WARN] {0} PID {1} is not running" -f $Label, $ProcessId) 'Yellow'
        return $false
    }
}

function Get-ManagedProcessInfo {
    param([int]$ProcessId)

    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $cim = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue

    return [pscustomobject]@{
        Id = [int]$process.Id
        ProcessName = [string]$process.ProcessName
        Path = [string]$(if ($cim -and $cim.ExecutablePath) { $cim.ExecutablePath } else { '' })
        CommandLine = [string]$(if ($cim -and $cim.CommandLine) { $cim.CommandLine } else { '' })
        Reason = ''
    }
}

function Test-ProcessSafeToStop {
    param(
        [pscustomobject]$ProcessInfo,
        [string]$RootPath
    )

    $name = $ProcessInfo.ProcessName.ToLowerInvariant()
    $commandLine = $ProcessInfo.CommandLine.ToLowerInvariant()
    $path = $ProcessInfo.Path.ToLowerInvariant()
    $normalizedRoot = $RootPath.ToLowerInvariant()

    # Docker Desktop owns Windows port-proxy processes for published container ports;
    # killing those PIDs tears down the engine instead of stopping this application.
    $protectedNames = @(
        'com.docker.backend',
        'com.docker.build',
        'com.docker.proxy',
        'docker desktop',
        'docker',
        'dockerd',
        'wsl',
        'wslhost',
        'vmmem',
        'vpnkit'
    )

    foreach ($protectedName in $protectedNames) {
        if ($name -eq $protectedName -or $name.StartsWith($protectedName + '.')) {
            $ProcessInfo.Reason = 'protected Docker/WSL runtime process'
            return $false
        }
    }

    if ($commandLine.Contains($normalizedRoot) -or $path.Contains($normalizedRoot)) {
        $ProcessInfo.Reason = 'command line or executable path belongs to this repository'
        return $true
    }

    $localRuntimeNames = @('node', 'npm', 'npx', 'pwsh', 'powershell')
    if ($localRuntimeNames -contains $name) {
        $ProcessInfo.Reason = 'local Node/PowerShell process on a managed application port'
        return $true
    }

    $ProcessInfo.Reason = 'process is not recognized as local Node/PowerShell launcher runtime'
    return $false
}

function Get-ListeningProcessIds {
    param([int[]]$Ports)

    $ids = New-Object System.Collections.Generic.HashSet[int]
    foreach ($port in $Ports) {
        $netstatMatches = netstat -ano | Select-String (":{0}\s" -f $port)
        foreach ($netstatMatch in $netstatMatches) {
            $parts = ($netstatMatch.Line -split '\s+') | Where-Object { $_ }
            if ($parts.Count -lt 5) {
                continue
            }

            $state = $parts[3]
            $candidatePid = 0
            if (-not [int]::TryParse($parts[-1], [ref]$candidatePid)) {
                continue
            }

            if ($state -eq 'LISTENING') {
                [void]$ids.Add($candidatePid)
            }
        }
    }

    return @($ids.GetEnumerator() | ForEach-Object { [int]$_ })
}

$resolvedRoot = Resolve-Path -Path $RepoPath
$rootPath = $resolvedRoot.Path
$tempDir = Join-Path $rootPath 'temp'
$activeStatePath = Join-Path $tempDir 'processes-active.json'

$stoppedAny = $false

if (Test-Path $activeStatePath) {
    $state = Get-Content -Path $activeStatePath -Raw | ConvertFrom-Json
    if ($state.backendPid) {
        if (Stop-ProcessIfRunning -ProcessId ([int]$state.backendPid) -Label 'backend' -RootPath $rootPath) {
            $stoppedAny = $true
        }
    }
    if ($state.frontendPid) {
        if (Stop-ProcessIfRunning -ProcessId ([int]$state.frontendPid) -Label 'frontend' -RootPath $rootPath) {
            $stoppedAny = $true
        }
    }
}

$portPids = Get-ListeningProcessIds -Ports @(3001, 4173, 5173)
foreach ($portPid in $portPids) {
    if (Stop-ProcessIfRunning -ProcessId $portPid -Label 'managed-port listener' -RootPath $rootPath) {
        $stoppedAny = $true
    }
}

if (Test-Path $activeStatePath) {
    Remove-Item -Path $activeStatePath -Force
}

$staleStateFiles = Get-ChildItem -Path $tempDir -Filter 'processes-*.json' -ErrorAction SilentlyContinue
foreach ($file in $staleStateFiles) {
    Remove-Item -Path $file.FullName -Force
}

if (-not $stoppedAny) {
    Write-Status '[INFO] No running launcher-managed processes were found.' 'Cyan'
} else {
    Write-Status '[OK] Launcher-managed processes stopped cleanly.' 'Green'
}
