$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
$master = Join-Path $PSScriptRoot 'icon/sub2agent.png'
$source = [Drawing.Image]::FromFile($master)
function Write-IconPng([string]$Target, [int]$Size) {
    $bitmap = [Drawing.Bitmap]::new($Size, $Size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($source, 0, 0, $Size, $Size)
        $bitmap.Save((Join-Path $repo $Target), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
    foreach ($size in 16,20,24,32,40,48,64,128,256) { Write-IconPng "build/windows/icon-$size.png" $size }
    Write-IconPng 'internal/gui/icon-1024.png' 1024
    Write-IconPng 'internal/gui/assets/icons/apple-touch-icon.png' 180
    Write-IconPng 'internal/gui/assets/icons/icon-512.png' 512
} finally { $source.Dispose() }
