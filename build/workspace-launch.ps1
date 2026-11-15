param([Parameter(Mandatory=$true)][string]$BuildPath)
$ErrorActionPreference='Stop'
$runtimeRoot=(Resolve-Path -LiteralPath $BuildPath).Path
if(!(Test-Path -LiteralPath (Join-Path $runtimeRoot 'manifest.json'))){throw 'An intranet review build is required'}
$qaHome=Join-Path $runtimeRoot 'qa-home'
$qaConfig=Join-Path $qaHome 'XDG_CONFIG_HOME/sub2agent'
New-Item -ItemType Directory -Path $qaHome,(Join-Path $qaHome 'AppData/Roaming'),(Join-Path $qaHome 'AppData/Local'),$qaConfig -Force | Out-Null
$settingsPath=Join-Path $qaConfig 'settings.json'
if(!(Test-Path -LiteralPath $settingsPath)){'{"port":19893,"lang":"zh","theme":"light","guideHidden":true,"featuresOff":["library","middleware","otel","redact","search","tools","warmups"]}' | Set-Content -LiteralPath $settingsPath -Encoding utf8}
$startInfo=[Diagnostics.ProcessStartInfo]::new((Join-Path $runtimeRoot 'sub2agent.exe'))
$startInfo.Arguments='web --addr 127.0.0.1:19894 --no-open'
$startInfo.UseShellExecute=$false
$startInfo.CreateNoWindow=$true
$startInfo.WorkingDirectory=$runtimeRoot
$keyPath=Join-Path $runtimeRoot 'qa-web-key.txt'
if(!(Test-Path -LiteralPath $keyPath)){[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant() | Set-Content -LiteralPath $keyPath}
$startInfo.Environment['MAGPIE_WEB_KEY']=(Get-Content -LiteralPath $keyPath -Raw).Trim()
$source=Get-Content (Join-Path $PSScriptRoot '../internal/agentenv/agentenv.go') -Raw
$varsBlock=$source.Substring($source.IndexOf('var Vars = []string{'))
$varsBlock=$varsBlock.Substring(0,$varsBlock.IndexOf("`n}"))
foreach($match in [regex]::Matches($varsBlock,'"([A-Z0-9_]+)"')){$startInfo.Environment.Remove($match.Groups[1].Value)|Out-Null}
foreach($keyName in @('USERPROFILE','HOME')){$startInfo.Environment[$keyName]=$qaHome}
$startInfo.Environment['APPDATA']=Join-Path $qaHome 'AppData/Roaming'
$startInfo.Environment['LOCALAPPDATA']=Join-Path $qaHome 'AppData/Local'
foreach($keyName in @('XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME')){$startInfo.Environment[$keyName]=Join-Path $qaHome $keyName}
$process=Start-Process -FilePath $startInfo.FileName -ArgumentList $startInfo.Arguments -WorkingDirectory $runtimeRoot -Environment $startInfo.Environment -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'qa-stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'qa-stderr.log')
$process.Id | Set-Content (Join-Path $runtimeRoot 'qa.pid')
Write-Output ('Isolated runtime PID '+$process.Id+'; gateway 19893, web 19894; authentication stays in qa-web-key.txt')
