param(
    [Parameter(Mandatory = $true)][string]$BunArchive,
    [string]$OutputRoot = '',
    [string]$Version = '0.1.3913-sub2agent.1'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputRoot) { $OutputRoot = Join-Path (Split-Path -Parent $repoRoot) 'magpie-builds' }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$bundleName = 'Sub2Agent-Magpie-windows-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$bundle = Join-Path $OutputRoot $bundleName
if (Test-Path -LiteralPath $bundle) { throw "Output already exists: $bundle" }
if ((Get-FileHash -LiteralPath $BunArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '78c221c2376f79731ccf4e4af0b3bb46d81fefa3296c5abee09ad8a1b21e68c6') {
    throw 'Expected the verified Bun 1.4.2 Windows x64 baseline archive'
}
New-Item -ItemType Directory -Path (Join-Path $bundle 'runtime') -Force | Out-Null
Push-Location $repoRoot
try {
    $env:CGO_ENABLED = '0'
    go run -tags intranet ./build/assetpack internal/gui/assets internal/gui/assets.zip
    if ($LASTEXITCODE -ne 0) { throw 'Asset packing failed' }
    go build -trimpath -buildvcs=false -ldflags='-s -w' -o internal/update/launcher-amd64.com ./internal/update/launcher
    if ($LASTEXITCODE -ne 0) { throw 'Console launcher build failed' }
    go run github.com/tc-hib/go-winres@v0.3.3 make --in build/windows/winres.json --arch amd64 --out rsrc
    if ($LASTEXITCODE -ne 0) { throw 'Windows resources failed' }
    go build -tags production,comlauncher,packedassets,intranet -trimpath -buildvcs=false "-ldflags=-s -w -H windowsgui -X main.version=$Version" -o (Join-Path $bundle 'Sub2Agent.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($BunArchive))
    try {
        $bunEntry = $zip.Entries | Where-Object FullName -eq 'bun-windows-x64-baseline/bun.exe'
        if (!$bunEntry) { throw 'Bun archive has no expected runtime' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($bunEntry, (Join-Path $bundle 'runtime\bun.exe'), $false)
    } finally { $zip.Dispose() }
    New-Item -ItemType File -Path (Join-Path $bundle '.portable') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $bundle 'licenses') | Out-Null
    Copy-Item -LiteralPath LICENSE,THIRD_PARTY_NOTICES -Destination (Join-Path $bundle 'licenses')
    Copy-Item -LiteralPath build\intranet\BUN-LICENSE.md -Destination (Join-Path $bundle 'licenses\BUN-LICENSE.md')
    Copy-Item -LiteralPath build\intranet\README.zh-CN.md -Destination (Join-Path $bundle 'README.txt')
    $fileRecords = @(Get-ChildItem -LiteralPath $bundle -Recurse -File | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    [ordered]@{ version = $Version; sourceCommit = (git rev-parse HEAD); workingTreeChanges = $true; profile = 'intranet'; market = 'http://172.21.0.177/magpie/plugins/registry.json'; registry = 'http://172.21.0.177/npm'; bunVersion = '1.4.2'; files = $fileRecords } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundle 'manifest.json') -Encoding utf8
    $archive = $bundle + '.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
    $exe = Get-Item -LiteralPath (Join-Path $bundle 'Sub2Agent.exe')
    $runtime = Get-Item -LiteralPath (Join-Path $bundle 'runtime\bun.exe')
    [ordered]@{ bundle = $bundle; archive = $archive; exeBytes = $exe.Length; bunBytes = $runtime.Length; unpackedBytes = (Get-ChildItem -LiteralPath $bundle -Recurse -File | Measure-Object Length -Sum).Sum; zipBytes = (Get-Item -LiteralPath $archive).Length; zipSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $OutputRoot ($bundleName + '.sizes.json'))
} finally { Pop-Location }
