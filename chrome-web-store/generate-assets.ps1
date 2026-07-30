$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot 'icons'
$storeDir = Join-Path $PSScriptRoot 'assets'
New-Item -ItemType Directory -Force -Path $runtimeDir, $storeDir | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon([int]$size, [string]$path) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $margin = [Math]::Max(1, [Math]::Round($size * 0.06))
    $shape = New-RoundedPath $margin $margin ($size - 2 * $margin) ($size - 2 * $margin) ([Math]::Max(2, $size * 0.19))
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#315d84'))
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d69b1d'))
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    try {
      $graphics.FillPath($background, $shape)
      $graphics.FillEllipse($accent, $size * 0.64, $size * 0.12, $size * 0.22, $size * 0.22)
      if ($size -ge 32) {
        $font = [System.Drawing.Font]::new('Arial', $size * 0.33, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        try {
          $format = [System.Drawing.StringFormat]::new()
          $format.Alignment = [System.Drawing.StringAlignment]::Center
          $format.LineAlignment = [System.Drawing.StringAlignment]::Center
          $graphics.DrawString('RQ', $font, $white, [System.Drawing.RectangleF]::new(0, $size * 0.08, $size, $size * 0.92), $format)
          $format.Dispose()
        } finally { $font.Dispose() }
      } else {
        $graphics.FillRectangle($white, $size * 0.25, $size * 0.32, $size * 0.50, $size * 0.12)
        $graphics.FillRectangle($white, $size * 0.25, $size * 0.53, $size * 0.38, $size * 0.12)
      }
    } finally {
      $shape.Dispose(); $background.Dispose(); $accent.Dispose(); $white.Dispose()
    }
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose(); $bitmap.Dispose()
  }
}

foreach ($size in 16, 32, 48, 128) {
  New-Icon $size (Join-Path $runtimeDir "icon-$size.png")
}
Copy-Item -Force -LiteralPath (Join-Path $runtimeDir 'icon-128.png') -Destination (Join-Path $storeDir 'store-icon-128.png')

$promo = [System.Drawing.Bitmap]::new(440, 280, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($promo)
try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#eef4f8'))
  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#315d84'))
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#526675'))
  $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d69b1d'))
  $icon = [System.Drawing.Image]::FromFile((Join-Path $runtimeDir 'icon-128.png'))
  $titleFont = [System.Drawing.Font]::new('Arial', 29, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new('Arial', 17, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  try {
    $graphics.FillRectangle($accent, 0, 258, 440, 22)
    $graphics.DrawImage($icon, 30, 59, 128, 128)
    $graphics.DrawString('Redmine', $titleFont, $blue, 184, 72)
    $graphics.DrawString('QOL Lite', $titleFont, $blue, 184, 108)
    $graphics.DrawString('Faster Redmine workflows', $bodyFont, $muted, 184, 158)
  } finally {
    $blue.Dispose(); $muted.Dispose(); $accent.Dispose(); $icon.Dispose(); $titleFont.Dispose(); $bodyFont.Dispose()
  }
  $promo.Save((Join-Path $storeDir 'small-promo-440x280.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose(); $promo.Dispose()
}

Write-Host "Assets generated in $runtimeDir and $storeDir"
