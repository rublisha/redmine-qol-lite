$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$runtimeFiles = @(
  'manifest.json',
  'background.js',
  'content-common.js',
  'content-watchers.js',
  'content-preview.js',
  'content-events.js',
  'content-history.js',
  'content-new-comments.js',
  'content-favorites.js',
  'content-drafts.js',
  'content-quote.js',
  'popup.html',
  'popup.css',
  'popup.js'
)

foreach ($file in $runtimeFiles) {
  $source = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing runtime file: $file" }
  if ($file.EndsWith('.js')) {
    & node --check $source
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $file" }
  }
}

$iconFiles = @($manifest.icons.PSObject.Properties.Value | Sort-Object -Unique)
foreach ($icon in $iconFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $icon) -PathType Leaf)) { throw "Missing manifest icon: $icon" }
}

$packageDir = Join-Path $PSScriptRoot 'package'
$stageDir = Join-Path $packageDir 'staging'
$zipPath = Join-Path $packageDir "redmine-qol-lite-$($manifest.version).zip"
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null
if (Test-Path -LiteralPath $stageDir) { Remove-Item -Recurse -Force -LiteralPath $stageDir }
New-Item -ItemType Directory -Path $stageDir | Out-Null

try {
  foreach ($file in $runtimeFiles) { Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stageDir }
  Copy-Item -Recurse -LiteralPath (Join-Path $repoRoot 'icons') -Destination $stageDir
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -Force -LiteralPath $zipPath }
  Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    if ($entries -notcontains 'manifest.json') { throw 'manifest.json is not at the ZIP root' }
    if ($entries | Where-Object { $_ -match '(^|/)(\.git|chrome-web-store|AGENTS\.md)(/|$)' }) {
      throw 'ZIP contains development or submission-only files'
    }
  } finally { $archive.Dispose() }
} finally {
  if (Test-Path -LiteralPath $stageDir) { Remove-Item -Recurse -Force -LiteralPath $stageDir }
}

Write-Host "Package ready: $zipPath"
