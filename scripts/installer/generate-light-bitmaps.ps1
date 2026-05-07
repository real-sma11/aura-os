# Regenerates the *-light.bmp installer artwork from the dark variants by
# inverting RGB channels. Run this when the dark artwork changes.
#
# Inversion is a deliberate placeholder: a glowing orb on a black field
# inverts to a darker shape on white, which preserves brand identity well
# enough for the NSIS wizard. Designers should replace the *-light.bmp
# files with hand-tuned artwork when polish is required; the file names
# and pixel formats (BMP3 24-bit) are what the installer's runtime swap
# logic in installer.nsi expects.

[CmdletBinding()]
param(
  [string]$AssetsDir
)

$ErrorActionPreference = 'Stop'
if (-not $AssetsDir) {
  $AssetsDir = Join-Path $PSScriptRoot '..\..\apps\aura-os-desktop\assets\installer'
}
Add-Type -AssemblyName System.Drawing

function Invoke-Invert {
  param([string]$Source, [string]$Destination)

  $src = [System.Drawing.Bitmap]::FromFile($Source)
  try {
    if ($src.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format24bppRgb) {
      throw "Source $Source must be Format24bppRgb (got $($src.PixelFormat)). NSIS prefers BMP3 24-bit."
    }

    $rect = New-Object System.Drawing.Rectangle 0, 0, $src.Width, $src.Height
    $data = $src.LockBits($rect,
      [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $stride = $data.Stride
      $bytesLen = [Math]::Abs($stride) * $src.Height
      $bytes = New-Object byte[] $bytesLen
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytesLen)
    } finally {
      $src.UnlockBits($data)
    }

    $rowWidth = $src.Width * 3
    for ($y = 0; $y -lt $src.Height; $y++) {
      $rowStart = $y * $stride
      for ($x = 0; $x -lt $rowWidth; $x++) {
        $bytes[$rowStart + $x] = [byte](255 - $bytes[$rowStart + $x])
      }
    }

    $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    $dst = New-Object System.Drawing.Bitmap $src.Width, $src.Height, $pixelFormat
    try {
      $dstRect = New-Object System.Drawing.Rectangle 0, 0, $dst.Width, $dst.Height
      $dstData = $dst.LockBits($dstRect,
        [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      try {
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $dstData.Scan0, $bytesLen)
      } finally {
        $dst.UnlockBits($dstData)
      }
      $dst.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
      $dst.Dispose()
    }
    $width = $src.Width
    $height = $src.Height
  } finally {
    $src.Dispose()
  }
  Write-Host "wrote $Destination (${width}x${height})"
}

$pairs = @(
  @{ Src = 'header-dark.bmp';  Dst = 'header-light.bmp'  },
  @{ Src = 'sidebar-dark.bmp'; Dst = 'sidebar-light.bmp' }
)

foreach ($pair in $pairs) {
  $srcPath = Join-Path $AssetsDir $pair.Src
  $dstPath = Join-Path $AssetsDir $pair.Dst
  if (-not (Test-Path $srcPath)) {
    throw "Missing source $srcPath"
  }
  Invoke-Invert -Source $srcPath -Destination $dstPath
}
