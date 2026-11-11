# Removes the ZX Spectrum emulator: shortcuts, the Settings > Apps entry and the program folder.
param([switch]$Quiet)
$name = 'ZX Spectrum'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
Add-Type -AssemblyName System.Windows.Forms

if (-not $Quiet) {
  $answer = [System.Windows.Forms.MessageBox]::Show("Remove $name from this computer?", "Uninstall $name", 'YesNo', 'Question')
  if ($answer -ne 'Yes') { exit }
}
foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) {
  Remove-Item (Join-Path $dir "$name.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ZXSpectrumEmulator' -Recurse -Force -ErrorAction SilentlyContinue
# this script lives in the folder it deletes, so leave first
Set-Location $env:TEMP
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
if (-not $Quiet) {
  [System.Windows.Forms.MessageBox]::Show("$name has been removed.", "Uninstall $name", 'OK', 'Information') | Out-Null
}
