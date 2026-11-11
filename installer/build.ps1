# Builds dist\ZX-Spectrum-Setup.exe with IExpress (built into Windows, nothing to download).
# IExpress packs a flat list of files, so the program goes in as app.zip and install.ps1 unpacks it.
param([string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$work = Join-Path $here 'build'
$app = Join-Path $work 'app'
$dist = Join-Path $here 'dist'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force $app, $dist | Out-Null

# program files (no tests, tools, server or games/)
Copy-Item (Join-Path $root 'index.html'), (Join-Path $root 'README.md') $app
Copy-Item (Join-Path $root 'css'), (Join-Path $root 'js'), (Join-Path $root 'roms') $app -Recurse
Set-Content (Join-Path $app 'VERSION') $Version -Encoding ascii

# file:// pages can't fetch() the ROM, so it also ships as a script
$rom = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'roms\48.rom')))
Set-Content (Join-Path $app 'js\rom48.js') "window.ZX48_ROM = '$rom';" -Encoding ascii
$html = Get-Content (Join-Path $app 'index.html') -Raw
$html = $html.Replace('<script src="js/main.js"></script>', "<script src=`"js/rom48.js`"></script>`n<script src=`"js/main.js`"></script>")
[IO.File]::WriteAllText((Join-Path $app 'index.html'), $html)

# icon: the Spectrum's rainbow flash on a black key, as a PNG-in-ICO
Add-Type -AssemblyName System.Drawing
$bmp = New-Object Drawing.Bitmap 256, 256
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$path = New-Object Drawing.Drawing2D.GraphicsPath
$r = 48; $path.AddArc(8, 8, $r, $r, 180, 90); $path.AddArc(248 - $r, 8, $r, $r, 270, 90)
$path.AddArc(248 - $r, 248 - $r, $r, $r, 0, 90); $path.AddArc(8, 248 - $r, $r, $r, 90, 90); $path.CloseFigure()
$g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(24, 24, 24))), $path)
$g.SetClip($path)
$colours = '#d8261c', '#f2c20f', '#3aa538', '#1d8fcf'
for ($i = 0; $i -lt 4; $i++) {
  $x = 96 + $i * 34
  $pts = [Drawing.PointF[]]@((New-Object Drawing.PointF ($x + 150), 0), (New-Object Drawing.PointF ($x + 184), 0),
    (New-Object Drawing.PointF ($x + 34 - 40), 256), (New-Object Drawing.PointF ($x - 40), 256))
  $g.FillPolygon((New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml($colours[$i]))), $pts)
}
$g.ResetClip()
$font = New-Object Drawing.Font 'Arial', 52, ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
$g.DrawString('ZX', $font, [Drawing.Brushes]::White, 26, 30)
$g.Dispose()
$ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $png = $ms.ToArray()
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)                    # header: icon, 1 image
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)       # 256x256, no palette
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $app 'zx-spectrum.ico'), $ico.ToArray())
$bmp.Save((Join-Path $work 'icon-preview.png'), [Drawing.Imaging.ImageFormat]::Png)

# payload
$pkg = Join-Path $work 'pkg'
New-Item -ItemType Directory -Force $pkg | Out-Null
Compress-Archive -Path (Join-Path $app '*') -DestinationPath (Join-Path $pkg 'app.zip')
Copy-Item (Join-Path $here 'install.ps1'), (Join-Path $here 'uninstall.ps1'), (Join-Path $here 'install.cmd') $pkg

$target = Join-Path $dist 'ZX-Spectrum-Setup.exe'
$files = 'app.zip', 'install.ps1', 'uninstall.ps1', 'install.cmd'
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=Install the ZX Spectrum 48K emulator ${Version}?
DisplayLicense=
FinishMessage=
TargetName=$target
FriendlyName=ZX Spectrum Setup
AppLaunched=cmd.exe /c .\install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=cmd.exe /c .\install.cmd quiet
UserQuietInstCmd=cmd.exe /c .\install.cmd quiet
$((0..($files.Count - 1) | ForEach-Object { "FILE$_=`"$($files[$_])`"" }) -join "`r`n")
[SourceFiles]
SourceFiles0=$pkg\
[SourceFiles0]
$((0..($files.Count - 1) | ForEach-Object { "%FILE$_%=" }) -join "`r`n")
"@
$sedFile = Join-Path $work 'setup.sed'
Set-Content $sedFile (($sed -split "`r?`n") -join "`r`n") -Encoding ascii
if (Test-Path $target) { Remove-Item $target -Force }
Start-Process iexpress.exe -ArgumentList '/N', '/Q', $sedFile -Wait -NoNewWindow
if (-not (Test-Path $target)) { throw 'IExpress did not produce the setup EXE.' }
'{0}  ({1:N0} KB)' -f $target, ((Get-Item $target).Length / 1KB)
