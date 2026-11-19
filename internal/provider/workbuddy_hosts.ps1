param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'

# The Go caller passes this whole script as one -Command argument, where a
# param() cannot bind a switch; the raw command line is the only seam left
# for flags there, and it is also where the script reads itself back for the
# elevated relaunch.
function GetCommandLineArgs { [Environment]::GetCommandLineArgs() }
$domains = @('copilot.tencent.com', 'www.codebuddy.cn', 'www.workbuddy.cn', 'download.codebuddy.cn', 'static.codebuddy.cn', 'assets.workbuddy.cn')

function Merge-WorkBuddyHosts([string]$content, [string]$gateway) {
    $lines = foreach ($line in ($content -split '\r?\n')) {
        $parts = $line -split '#', 2
        $fields = @($parts[0].Trim() -split '\s+' | Where-Object { $_ })
        if ($fields.Count -gt 1) {
            $remaining = @($fields | Select-Object -Skip 1 | Where-Object { $_ -notin $domains })
            if ($remaining.Count -ne ($fields.Count - 1)) {
                if ($remaining.Count) {
                    $line = $fields[0] + "`t" + ($remaining -join ' ')
                    if ($parts.Count -gt 1) { $line += ' #' + $parts[1] }
                } elseif ($parts.Count -gt 1 -and $parts[1].Trim() -ne 'Sub2Agent WorkBuddy') {
                    $line = '#' + $parts[1]
                } else { continue }
            }
        }
        $line
    }
    $body = ($lines -join "`r`n").TrimEnd("`r", "`n")
    $entries = $domains | ForEach-Object { "$gateway`t$_ # Sub2Agent WorkBuddy" }
    return $body + "`r`n" + ($entries -join "`r`n") + "`r`n"
}

if ($SelfTest -or ((GetCommandLineArgs) -contains '-SelfTest')) {
    $before = "127.0.0.1 localhost`r`n1.2.3.4 www.workbuddy.cn keep.example # keep comment`r`n# original`r`n"
    $after = Merge-WorkBuddyHosts $before '172.21.248.13'
    if (!$after.Contains("127.0.0.1 localhost") -or !$after.Contains("1.2.3.4`tkeep.example # keep comment")) { throw 'Unrelated hosts were changed' }
    if ((Merge-WorkBuddyHosts $after '172.21.248.13') -cne $after) { throw 'Hosts update is not idempotent' }
    $failover = Merge-WorkBuddyHosts $after '172.21.248.17'
    if ($failover.Contains('172.21.248.13') -or ([regex]::Matches($failover, '172\.21\.248\.17')).Count -ne 6) { throw 'Gateway replacement failed' }
    Write-Output 'WorkBuddy hosts self-check passed'
    exit 0
}

$gateway = $null
foreach ($candidate in @('172.21.248.13', '172.21.248.17')) {
    $socket = New-Object Net.Sockets.TcpClient
    try {
        $attempt = $socket.ConnectAsync($candidate, 443)
        if ($attempt.Wait(2000) -and $socket.Connected) { $gateway = $candidate; break }
    } catch { } finally { $socket.Dispose() }
}
if (!$gateway) { throw 'WorkBuddy enterprise gateways are unreachable. Connect to the office network or VDI and retry.' }

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$encoding = New-Object Text.UTF8Encoding($false, $true)
$bytes = [IO.File]::ReadAllBytes($hostsPath)
try { $current = $encoding.GetString($bytes) } catch { $encoding = [Text.Encoding]::Default; $current = $encoding.GetString($bytes) }
$next = Merge-WorkBuddyHosts $current $gateway
if ($next -ceq $current) { Write-Output $gateway; exit 0 }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) {
    # Pass the fixed script in memory; no elevated script is loaded from a writable temp file.
    $script = (GetCommandLineArgs)[-1]
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    $child = Start-Process -FilePath "$PSHOME\powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
    if ($child.ExitCode -ne 0) { throw 'WorkBuddy hosts configuration failed or administrator access was denied.' }
    if ([IO.File]::ReadAllText($hostsPath, $encoding) -cne $next) { throw 'WorkBuddy hosts configuration was not applied. Please retry.' }
    Write-Output $gateway
    exit 0
}

$backup = $hostsPath + '.sub2agent-workbuddy.' + [Guid]::NewGuid().ToString('N') + '.bak'
[IO.File]::WriteAllBytes($backup, $bytes)
# Refuse to overwrite a hosts file changed while the backup was being made.
if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($hostsPath)) -cne [Convert]::ToBase64String($bytes)) { throw 'Hosts changed during setup; retry.' }
[IO.File]::WriteAllText($hostsPath, $next, $encoding)
Clear-DnsClientCache
Write-Output $gateway
