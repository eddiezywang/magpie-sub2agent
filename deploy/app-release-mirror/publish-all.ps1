param([Parameter(Mandatory=$true)][string]$ReleaseDir,[Parameter(Mandatory=$true)][string]$JumpSession,[string]$KfSeedPath='',[switch]$ForceTransfer)
$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$meta=(node "$here/verify-release.mjs" $ReleaseDir | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or !$meta.version -or !$meta.sha256) { throw 'Signed release validation failed' }
$version=$meta.version; $digest=$meta.sha256
if ($JumpSession -cnotmatch '^tj-[a-f0-9]+$') { throw 'JumpSession must be a test-jump session ID' }
$stage=Join-Path ([IO.Path]::GetTempPath()) ('sub2agent-release-'+$version+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath $meta.file -Destination (Join-Path $stage 'asset.exe') -Force
Copy-Item -LiteralPath (Join-Path $ReleaseDir 'latest.json') -Destination (Join-Path $stage 'latest.json') -Force
Copy-Item -LiteralPath (Join-Path $here 'apply-release.py') -Destination (Join-Path $stage 'apply-release.py') -Force
$archive=Join-Path $stage ('release-'+$version+'.tar')
tar -cf $archive -C $stage asset.exe latest.json apply-release.py
if ($LASTEXITCODE -ne 0) { throw 'Release archive failed' }
# Public host: stage, verify on host, atomically publish.
$remote='/tmp/sub2agent-release-'+$version+'.tar'
scp -q $archive "root@124.220.199.224:$remote"
if($LASTEXITCODE -ne 0){throw 'Public mirror transfer failed'}
$cmd="tar -xOf $remote apply-release.py > /tmp/sub2agent-apply-$version.py && python3 /tmp/sub2agent-apply-$version.py $remote /var/www/sub2agent-update-8899/sub2agent/releases $version $digest"
ssh -o BatchMode=yes root@124.220.199.224 $cmd
if($LASTEXITCODE -ne 0){throw 'Public mirror publish failed'}
$kfScript='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-sync-domain.js'
Get-Content -Raw (Join-Path $here 'sync-domain.js') | hc file write --on kf $kfScript | Out-Null
if($LASTEXITCODE -ne 0){throw 'KF domain script transfer failed'}
# Skip the large jump transfer only if the already-published version and
# actual file digest both match. A stale or absent feed forces a full publish.
$kfFeed='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-check-feed.ps1'
$feedCheck=@"
`$ErrorActionPreference='Stop'
`$r=Invoke-RestMethod -Uri 'http://172.21.0.177:18989/sub2agent/releases/latest.json' -TimeoutSec 10
if (`$r.version -eq '$version' -and `$r.assets.'magpie-windows-amd64.exe'.sha256 -eq '$digest') {Write-Output 'FEED_MATCH'}
"@
$feedCheck | hc file write --on kf $kfFeed | Out-Null
$feedResult=hc exec --on kf "powershell -NoProfile -File $kfFeed"
$hashCmd="ssh -o BatchMode=yes -p 36000 eddiewang@172.21.0.177 sha256sum /opt/sub2agent-plugin-market/www/sub2agent/releases/$version/magpie-windows-amd64.exe"
$hashResult=hc exec --on kf "wecli test-jump exec $JumpSession `"$hashCmd`" --timeout 20"
$intranetCurrent=(-not $ForceTransfer) -and (($feedResult -join '') -match 'FEED_MATCH') -and (($hashResult -join '') -match $digest)
if (-not $intranetCurrent) {
# Send the archive to KF via binary-safe hc, then through the authenticated jump.
$kfArchive='C:\Users\eddiewang\AppData\Local\Temp\release-'+$version+'.tar'
$kfScript='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-sync-domain.js'
# A previously verified KF binary can seed an identical release without
# retransferring it; future versions automatically use the chunked path.
$seed=$KfSeedPath
$check=''
if ($seed) {
    if ($seed -cnotmatch '^C:\\Users\\eddiewang\\AppData\\Local\\Temp\\[A-Za-z0-9_.\\-]+$' -or $seed.Contains('..')) { throw 'KfSeedPath must be a safe path under KF temp' }
    $check=hc exec --on kf "powershell -NoProfile -Command `"if (Test-Path -LiteralPath '$seed') { (Get-FileHash -Algorithm SHA256 -LiteralPath '$seed').Hash }`""
}
if (($check -join '') -match $digest) {
    $remoteManifest='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-seed-latest-'+$version+'.json'
    $remoteApply='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-seed-apply-'+$version+'.py'
    Get-Content -Raw (Join-Path $stage 'latest.json') | hc file write --on kf $remoteManifest | Out-Null
    Get-Content -Raw (Join-Path $stage 'apply-release.py') | hc file write --on kf $remoteApply | Out-Null
    $kfSeed=@"
`$ErrorActionPreference='Stop'
`$stage=Join-Path `$env:TEMP ('sub2agent-seed-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path `$stage | Out-Null
Copy-Item -LiteralPath '$seed' -Destination (Join-Path `$stage 'asset.exe')
Copy-Item -LiteralPath '$remoteManifest' -Destination (Join-Path `$stage 'latest.json')
Copy-Item -LiteralPath '$remoteApply' -Destination (Join-Path `$stage 'apply-release.py')
tar -cf '$kfArchive' -C `$stage asset.exe latest.json apply-release.py
if (`$LASTEXITCODE -ne 0) {throw 'KF tar failed'}
Write-Output 'KF_ARCHIVE_OK'
"@
    $seedScript='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-seed-'+$version+'.ps1'
    $kfSeed | hc file write --on kf $seedScript | Out-Null
    $comb=hc exec --on kf "powershell -NoProfile -File $seedScript"
    if (($comb -join "`n") -notmatch 'KF_ARCHIVE_OK') {throw 'KF seed assembly failed'}
} else {
# hc limits a single piped write to 8 MiB; transfer 512 KiB chunks and
# concatenate them using one PowerShell process on KF, then verify the archive.
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$inputStream=[IO.File]::OpenRead($archive)
$chunkPaths=@(); $index=0
try {
    $buffer=New-Object byte[] (512KB)
    while (($count=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
        $chunk=Join-Path $stage ("chunk-{0:D4}" -f $index)
        $stream=[IO.File]::Create($chunk); try {$stream.Write($buffer,0,$count)} finally {$stream.Dispose()}
        $kfChunk=$kfArchive+('.part{0:D4}' -f $index)
        $sent=$false
        for($attempt=1;$attempt -le 3 -and -not $sent;$attempt++){
            $proc=Start-Process -FilePath hc -ArgumentList @('file','write','--on','kf',$kfChunk) -RedirectStandardInput $chunk -NoNewWindow -Wait -PassThru
            $sent=($proc.ExitCode -eq 0)
        }
        if(-not $sent){throw "KF transfer failed at chunk $index after 3 attempts"}
        $chunkPaths += $kfChunk; $index++
    }
} finally {$inputStream.Dispose()}
$chunksLiteral=($chunkPaths | ForEach-Object {"'"+$_+"'"}) -join ','
$kfCombine=@"
`$ErrorActionPreference='Stop'
`$target='$kfArchive'; `$temporary=`$target+'.pending'; `$parts=@($chunksLiteral)
`$o=[IO.File]::Open(`$temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try { foreach(`$part in `$parts) { `$i=[IO.File]::OpenRead(`$part); try { `$i.CopyTo(`$o) } finally { `$i.Dispose() } } } finally { `$o.Dispose() }
if ((Get-FileHash -LiteralPath `$temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne '$hash') {throw 'KF archive checksum mismatch'}
Move-Item -LiteralPath `$temporary -Destination `$target -Force
foreach(`$part in `$parts) {Remove-Item -LiteralPath `$part}
Write-Output 'KF_ARCHIVE_OK'
"@
$kfCombinePath='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-combine-'+$version+'.ps1'
$kfCombine | hc file write --on kf $kfCombinePath | Out-Null
$comb=hc exec --on kf "powershell -NoProfile -File $kfCombinePath"
if (($comb -join "`n") -notmatch 'KF_ARCHIVE_OK') { throw 'KF archive assembly failed' }

}
Get-Content -Raw (Join-Path $here 'sync-domain.js') | hc file write --on kf $kfScript | Out-Null
if($LASTEXITCODE -ne 0){throw 'KF domain script transfer failed'}
$upload="wecli test-jump upload $JumpSession $kfArchive --remote-dir /tmp --timeout 300"
hc exec --on kf $upload
if($LASTEXITCODE -ne 0){throw 'Jump upload failed'}
# Transfer from the jump to 0.177, extract only the release installer, then
# validate and atomically publish. Wait output is checked for a success marker.
$remoteCmd="scp -q -o BatchMode=yes -o ConnectTimeout=10 -P 36000 /tmp/release-$version.tar eddiewang@172.21.0.177:/tmp/release-$version.tar && ssh -o BatchMode=yes -o ConnectTimeout=10 -p 36000 eddiewang@172.21.0.177 'tar -xOf /tmp/release-$version.tar apply-release.py > /tmp/sub2agent-apply-$version.py && sudo -n /opt/python311/bin/python3.11 /tmp/sub2agent-apply-$version.py /tmp/release-$version.tar /opt/sub2agent-plugin-market/www/sub2agent/releases $version $digest'"
$result=hc exec --on kf "wecli test-jump exec $JumpSession `"$remoteCmd`" --timeout 120"
if(($result -join "`n") -notmatch 'RELEASE_APPLIED') { $result=hc exec --on kf "wecli test-jump wait $JumpSession --timeout 120" }
if(($result -join "`n") -notmatch 'RELEASE_APPLIED') { throw '0.177 publish did not confirm success; inspect jump session' }
 } else { Write-Output "0.177 already has verified $version" }
# The Pod cannot reach the public mirror, but can reach 0.177. It stores its own
# copy. This makes no proxy and does not modify the existing wemail service.
$domainScript=@"
`$ErrorActionPreference='Stop'
`$pod=kubectl get pods -n 1631-ymj -l app=idas-aigateway-wemail -o jsonpath='{.items[0].metadata.name}'
if (!`$pod) { throw 'wemail Pod not found' }
Get-Content -Raw '$kfScript' | kubectl exec -i -n 1631-ymj `$pod -- node - '$version' '$digest'
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
"@
$kfPS='C:\Users\eddiewang\AppData\Local\Temp\sub2agent-sync-domain.ps1'
$domainScript | hc file write --on kf $kfPS | Out-Null
if($LASTEXITCODE -ne 0){throw 'KF domain invocation transfer failed'}
$out=hc run --on kf --bg "powershell -NoProfile -File $kfPS" | ConvertFrom-Json
if(!$out.address){throw 'Could not start domain sync'}
hc wait $out.address --output DOMAIN_SYNC_OK --timeout 300 | Out-Null
$log=hc read $out.address
if(($log -join "`n") -notmatch 'DOMAIN_SYNC_OK'){throw 'Domain sync did not confirm success; inspect KF job'}
Write-Output "All three sources published $version $digest"
