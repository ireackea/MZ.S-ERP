$ports = 3001,5173,5174
foreach ($p in $ports) {
  $lines = netstat -ano | Select-String ":$p\s"
  if ($lines) {
    foreach ($line in $lines) {
      $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
      $procId = $parts[-1]
      try {
        Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop
        Write-Output "Stopped PID $procId on port $p"
      } catch {
        Write-Output ("Could not stop PID {0} on port {1}: {2}" -f $procId, $p, $_)
      }
    }
  } else {
    Write-Output "No process found on port $p"
  }
}

# rotate logs
if (Test-Path .\backend.log) { Move-Item -Path .\backend.log -Destination .\backend.log.old -Force }
if (Test-Path .\frontend.log) { Move-Item -Path .\frontend.log -Destination .\frontend.log.old -Force }

# start backend and frontend
Start-Process -NoNewWindow -FilePath "powershell" -ArgumentList '-NoProfile','-Command','npm run backend:dev ^> backend.log 2^>^&1'
Start-Process -NoNewWindow -FilePath "powershell" -ArgumentList '-NoProfile','-Command','npm run dev ^> frontend.log 2^>^&1'
Write-Output "Started backend and frontend; logs redirected to backend.log and frontend.log" 
