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
        [string]$Label
    )

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
        Write-Status ("[OK] Stopped {0} PID {1}" -f $Label, $process.Id) 'Green'
    } catch {
        Write-Status ("[WARN] {0} PID {1} is not running" -f $Label, $ProcessId) 'Yellow'
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
        Stop-ProcessIfRunning -ProcessId ([int]$state.backendPid) -Label 'backend'
        $stoppedAny = $true
    }
    if ($state.frontendPid) {
        Stop-ProcessIfRunning -ProcessId ([int]$state.frontendPid) -Label 'frontend'
        $stoppedAny = $true
    }
}

$portPids = Get-ListeningProcessIds -Ports @(3001, 4173, 5173)
foreach ($portPid in $portPids) {
    try {
        $process = Get-Process -Id $portPid -ErrorAction Stop
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
        Write-Status ("[OK] Cleared PID {0} from managed ports" -f $process.Id) 'Green'
        $stoppedAny = $true
    } catch {
        Write-Status ("[WARN] PID {0} was already stopped" -f $portPid) 'Yellow'
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
