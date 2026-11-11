# Installs the ZX Spectrum emulator for the current user (no admin rights needed).
# Run by the setup EXE from its temporary folder, next to app.zip.
$ErrorActionPreference = 'Stop'
$name = 'ZX Spectrum'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Windows.Forms

try {
  # fresh copy of the program files
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Expand-Archive -Path (Join-Path $here 'app.zip') -DestinationPath $dest -Force
  Copy-Item (Join-Path $here 'uninstall.ps1') $dest -Force

  # open in an Edge app window (no tabs or address bar); fall back to the default browser
  $page = Join-Path $dest 'index.html'
  $url = 'file:///' + ($page -replace '\\', '/' -replace ' ', '%20')
  $edge = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
  $icon = Join-Path $dest 'zx-spectrum.ico'

  $shell = New-Object -ComObject WScript.Shell
  $links = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk")
  )
  foreach ($lnk in $links) {
    $s = $shell.CreateShortcut($lnk)
    if ($edge -and (Test-Path $edge)) {
      $s.TargetPath = $edge
      $s.Arguments = "--app=`"$url`" --window-size=1280,1000"
    } else {
      $s.TargetPath = $page
    }
    $s.WorkingDirectory = $dest
    $s.IconLocation = "$icon,0"
    $s.Description = 'ZX Spectrum 48K emulator'
    $s.Save()
  }

  # Settings > Apps entry, so it can be removed like any other program
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ZXSpectrumEmulator"
  New-Item -Path $key -Force | Out-Null
  $uninst = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\uninstall.ps1`""
  $size = [int]((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1KB)
  $vals = @{
    DisplayName = $name; DisplayVersion = (Get-Content (Join-Path $dest 'VERSION') -Raw).Trim(); Publisher = 'Akis Belimpasakis'
    DisplayIcon = $icon; InstallLocation = $dest; UninstallString = $uninst; QuietUninstallString = "$uninst -Quiet"
  }
  foreach ($k in $vals.Keys) { Set-ItemProperty -Path $key -Name $k -Value $vals[$k] }
  Set-ItemProperty -Path $key -Name EstimatedSize -Value $size -Type DWord
  Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord

  if ($env:ZX_QUIET -ne '1') {
    $answer = [System.Windows.Forms.MessageBox]::Show(
      "ZX Spectrum is installed.`n`nYou'll find it on the desktop and in the Start menu.`n`nStart it now?",
      "$name Setup", 'YesNo', 'Information')
    if ($answer -eq 'Yes') { Start-Process $links[0] }
  }
} catch {
  [System.Windows.Forms.MessageBox]::Show("Setup failed:`n`n$($_.Exception.Message)", "$name Setup", 'OK', 'Error') | Out-Null
  exit 1
}
