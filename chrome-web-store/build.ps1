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
$zipPath = Join-Path $packageDir "redmine-qol-lite-$($manifest.version).zip"
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null
if (Test-Path -LiteralPath $zipPath) { Remove-Item -Force -LiteralPath $zipPath }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Имена внутри архива задаём сами: Compress-Archive в Windows PowerShell 5.1
# пишет разделитель "\", а спецификация ZIP требует "/". Chrome такой архив
# распаковывает как файл с обратным слэшем в имени, и иконки теряются.
$payload = [ordered]@{}
foreach ($file in $runtimeFiles) { $payload[$file] = Join-Path $repoRoot $file }
foreach ($icon in (Get-ChildItem -File -LiteralPath (Join-Path $repoRoot 'icons') | Sort-Object Name)) {
  $payload["icons/$($icon.Name)"] = $icon.FullName
}

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in $payload.Keys) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $payload[$name], $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($archive.Entries | ForEach-Object FullName)
  if ($entries -notcontains 'manifest.json') { throw 'manifest.json is not at the ZIP root' }
  if ($entries | Where-Object { $_ -match '\\' }) { throw 'ZIP entry names must use "/" as separator' }
  if ($entries | Where-Object { $_ -match '(^|/)(\.git|chrome-web-store|AGENTS\.md)(/|$)' }) {
    throw 'ZIP contains development or submission-only files'
  }
  foreach ($icon in $iconFiles) {
    if ($entries -notcontains $icon) { throw "Missing manifest icon in ZIP: $icon" }
  }
} finally { $archive.Dispose() }

Write-Host "Package ready: $zipPath"
