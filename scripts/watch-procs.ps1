# Note chaque nouveau processus lié à Spin A Doc (application, installeur, désinstalleur, Au_.exe, tasklist/taskkill lancés par l'installeur)
# avec PID, parent, chemin et ligne de commande, puis sa disparition. S'arrête quand le fichier $stop existe.
param([string]$out, [string]$stop)
$seen = @{}
while (-not (Test-Path $stop)) {
  $now = Get-Date
  $procs = Get-CimInstance Win32_Process -Filter "Name='Spin A Doc.exe' OR Name LIKE 'SpinADoc%' OR Name LIKE 'Uninstall Spin%' OR Name LIKE 'Au_%' OR Name='taskkill.exe' OR Name='tasklist.exe' OR Name='WerFault.exe'"
  $ids = @{}
  foreach ($p in $procs) {
    $ids[$p.ProcessId] = 1
    if (-not $seen.ContainsKey($p.ProcessId)) {
      $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
      $line = "{0} + pid={1} {2} parent={3} ({4}) chemin={5} cmd={6}" -f $now.ToString('HH:mm:ss.fff'), $p.ProcessId, $p.Name, $p.ParentProcessId, $(if ($par) { $par.Name } else { '?' }), $p.ExecutablePath, $p.CommandLine
      Add-Content -Path $out -Value $line -Encoding UTF8
      $seen[$p.ProcessId] = $p.Name
    }
  }
  foreach ($k in @($seen.Keys)) { if (-not $ids.ContainsKey($k)) { Add-Content -Path $out -Value ("{0} - pid={1} {2}" -f $now.ToString('HH:mm:ss.fff'), $k, $seen[$k]) -Encoding UTF8; $seen.Remove($k) } }
  Start-Sleep -Milliseconds 150
}
