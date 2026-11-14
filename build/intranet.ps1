param(
    [string]$BunArchive = '',
    [string]$OutputRoot = '',
    [string]$Version = '0.1.3913-sub2agent.1',
    [string]$Sub2AgentSource = '',
    [switch]$WithoutBun,
    [switch]$SingleFile
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputRoot) { $OutputRoot = Join-Path (Split-Path -Parent $repoRoot) 'magpie-builds' }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$bundleName = 'sub2agent-windows-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$bundle = Join-Path $OutputRoot $bundleName
if (Test-Path -LiteralPath $bundle) { throw "Output already exists: $bundle" }
if ($SingleFile) { $WithoutBun = $true }
if (!$WithoutBun -and (!$BunArchive -or (Get-FileHash -LiteralPath $BunArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '78c221c2376f79731ccf4e4af0b3bb46d81fefa3296c5abee09ad8a1b21e68c6')) {
    throw 'Expected the verified Bun 1.4.2 Windows x64 baseline archive'
}
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
if (!$WithoutBun) { New-Item -ItemType Directory -Path (Join-Path $bundle 'runtime') | Out-Null }
Push-Location $repoRoot
try {
    $sourceCommit = git rev-parse HEAD
    $sourceChanges = @(git status --porcelain)
    $env:CGO_ENABLED = '0'
    if (!$Sub2AgentSource) { $Sub2AgentSource = Join-Path (Split-Path -Parent $repoRoot) 'sub2agent' }
    node build/sub2agent-providers.mjs $Sub2AgentSource
    if ($LASTEXITCODE -ne 0) { throw 'Private Sub2Agent provider build failed' }
    $buildTags = 'production,comlauncher,packedassets,intranet'
    if ($SingleFile) {
        go run ./build/providerpack build/sub2agent-runtime internal/plugin/baseline.zip
        if ($LASTEXITCODE -ne 0) { throw 'Provider embedding failed' }
        $buildTags += ',embeddedproviders'
    }
    go run -tags intranet ./build/assetpack internal/gui/assets internal/gui/assets.zip
    if ($LASTEXITCODE -ne 0) { throw 'Asset packing failed' }
    go build -trimpath -buildvcs=false -ldflags='-s -w' -o internal/update/launcher-amd64.com ./internal/update/launcher
    if ($LASTEXITCODE -ne 0) { throw 'Console launcher build failed' }
    go run github.com/tc-hib/go-winres@v0.3.3 make --in build/windows/winres-intranet.json --arch amd64 --out rsrc
    if ($LASTEXITCODE -ne 0) { throw 'Windows resources failed' }
    go build -tags $buildTags -trimpath -buildvcs=false "-ldflags=-s -w -H windowsgui -X main.version=$Version" -o (Join-Path $bundle 'sub2agent.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (!$SingleFile) {
    New-Item -ItemType Directory -Path (Join-Path $bundle 'providers') | Out-Null
    foreach ($kind in 'codebuddy','workbuddy','trae','aiep','community-antigravity','community-commandcode','community-cursor','community-devin','community-factory','community-grok','community-kiro','community-mimo','community-qoder','community-workbuddy','community-zcode','community-zed') {
        Copy-Item -LiteralPath (Join-Path $repoRoot "build/sub2agent-runtime/$kind") -Destination (Join-Path $bundle 'providers') -Recurse
    }
    Copy-Item -LiteralPath build/sub2agent-runtime/source.json -Destination (Join-Path $bundle 'providers/source.json')
    if (!$WithoutBun) {
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($BunArchive))
    try {
        $bunEntry = $zip.Entries | Where-Object FullName -eq 'bun-windows-x64-baseline/bun.exe'
        if (!$bunEntry) { throw 'Bun archive has no expected runtime' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($bunEntry, (Join-Path $bundle 'runtime\bun.exe'), $false)
    } finally { $zip.Dispose() }
    }
    New-Item -ItemType File -Path (Join-Path $bundle '.portable') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $bundle 'licenses') | Out-Null
    Copy-Item -LiteralPath LICENSE,THIRD_PARTY_NOTICES -Destination (Join-Path $bundle 'licenses')
    Copy-Item -LiteralPath plugins/modelmap/LICENSE -Destination (Join-Path $bundle 'licenses/model-map-LICENSE')
    Copy-Item -LiteralPath build\intranet\BUN-LICENSE.md -Destination (Join-Path $bundle 'licenses\BUN-LICENSE.md')
    Copy-Item -LiteralPath build\intranet\README.zh-CN.md -Destination (Join-Path $bundle 'README.txt')
    if ($WithoutBun) {
        $lightReadme = Get-Content -LiteralPath (Join-Path $bundle 'README.txt') -Raw -Encoding utf8
        $lightReadme = $lightReadme.Replace('本包附带 Bun 1.4.2 插件运行时', '本轻量包不附带 Bun；首次使用供应商插件时从行内 npm 仓库下载固定版本 1.4.2，校验后缓存并复用，无需安装 npm')
        $lightReadme | Set-Content -LiteralPath (Join-Path $bundle 'README.txt') -Encoding utf8
    }
    }
    $fileRecords = @(Get-ChildItem -LiteralPath $bundle -Recurse -File | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $manifestPath = if ($SingleFile) { $bundle + '.manifest.json' } else { Join-Path $bundle 'manifest.json' }
    [ordered]@{ version = $Version; sourceCommit = $sourceCommit; workingTreeChanges = ($sourceChanges.Count -gt 0); profile = 'intranet'; singleFile = [bool]$SingleFile; bundledBun = !$WithoutBun; bunVersion = '1.4.2'; files = $fileRecords } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $archive = $bundle + '.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $archive, [IO.Compression.CompressionLevel]::Optimal, !$SingleFile)
    $exe = Get-Item -LiteralPath (Join-Path $bundle 'sub2agent.exe')
    $runtimeBytes = if ($WithoutBun) { 0 } else { (Get-Item -LiteralPath (Join-Path $bundle 'runtime\bun.exe')).Length }
    [ordered]@{ bundle = $bundle; archive = $archive; exeBytes = $exe.Length; bunBytes = $runtimeBytes; unpackedBytes = (Get-ChildItem -LiteralPath $bundle -Recurse -File | Measure-Object Length -Sum).Sum; zipBytes = (Get-Item -LiteralPath $archive).Length; zipSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $OutputRoot ($bundleName + '.sizes.json'))
} finally { Pop-Location }
