$ErrorActionPreference = 'Stop'

$root = 'src'
$exts = @('*.ts','*.tsx','*.js','*.jsx','*.css','*.html','*.md','*.json')
$files = Get-ChildItem -Path $root -Recurse -File -Include $exts
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-ArabicCount([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return 0 }
  return ([regex]::Matches($s, '[\u0600-\u06FF]').Count)
}

function Get-MarkerCount([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return 0 }
  return ([regex]::Matches($s, '[\u00D8\u00D9\u00C2-\u00D7\u0637\u0638\u00A2-\u00A5]').Count)
}

function Repair-Line([string]$line) {
  if (-not $line -or -not ([regex]::IsMatch($line, '[\u00D8\u00D9\u0637\u0638\u00C2\u00A2-\u00A5]'))) { return $line }

  $bytes = New-Object byte[] ($line.Length)
  for ($i = 0; $i -lt $line.Length; $i++) {
    $bytes[$i] = [byte]([int][char]$line[$i] -band 0xFF)
  }

  $repaired = [System.Text.Encoding]::UTF8.GetString($bytes)
  $scoreOriginal = (Get-ArabicCount $line) - (2 * (Get-MarkerCount $line))
  $scoreRepaired = (Get-ArabicCount $repaired) - (2 * (Get-MarkerCount $repaired))

  if ($scoreRepaired -gt $scoreOriginal) { return $repaired }
  return $line
}

$changedFiles = New-Object System.Collections.Generic.List[string]
$totalLineFixes = 0

foreach ($f in $files) {
  $path = $f.FullName
  $text = [System.IO.File]::ReadAllText($path)
  $lines = $text -split "`r?`n", 0
  $fileChanged = $false

  for ($i = 0; $i -lt $lines.Length; $i++) {
    $fixed = Repair-Line $lines[$i]
    if ($fixed -ne $lines[$i]) {
      $lines[$i] = $fixed
      $fileChanged = $true
      $totalLineFixes++
    }
  }

  if ($fileChanged) {
    $newText = [string]::Join("`n", $lines)
    [System.IO.File]::WriteAllText($path, $newText, $utf8NoBom)
    $changedFiles.Add($path)
  }
}

Write-Output ("FILES_CHANGED=" + $changedFiles.Count)
Write-Output ("LINES_FIXED=" + $totalLineFixes)
$changedFiles | Select-Object -First 100
