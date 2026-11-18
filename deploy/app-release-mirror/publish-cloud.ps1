param([Parameter(Mandatory=$true)][string]$ReleaseDir)
$ErrorActionPreference = 'Stop'
$hostName = 'root@134.175.165.190'
$destination = '/srv/sub2agent-release-stage'
$metadata = node "$PSScriptRoot/verify-release.mjs" $ReleaseDir | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$metadata.version) { throw 'Signed release validation failed' }
$staging = (ssh -o BatchMode=yes $hostName 'mktemp -d /srv/.sub2agent-release-upload.XXXXXXXX').Trim()
if ($LASTEXITCODE -ne 0 -or $staging -cnotmatch '^/srv/\.sub2agent-release-upload\.[A-Za-z0-9]+$') { throw 'Cloud staging creation failed' }
try {
    scp -q -o BatchMode=yes (Join-Path $ReleaseDir 'latest.json') "${hostName}:$staging/"
    if ($LASTEXITCODE -ne 0) { throw 'Cloud manifest transfer failed' }
    ssh -o BatchMode=yes $hostName "mkdir -- $staging/$($metadata.version)"
    if ($LASTEXITCODE -ne 0) { throw 'Cloud version staging creation failed' }
    foreach ($file in $metadata.files) {
        scp -q -o BatchMode=yes $file.file "${hostName}:$staging/$($metadata.version)/"
        if ($LASTEXITCODE -ne 0) { throw 'Cloud asset transfer failed' }
    }
    ssh -o BatchMode=yes $hostName "flock /run/sub2agent-release-stage.lock node /opt/sub2agent-release-stage/promote.mjs $destination $staging"
    if ($LASTEXITCODE -ne 0) { throw 'Cloud release promotion failed' }
} finally {
    ssh -o BatchMode=yes $hostName "rm -rf -- $staging"
}
