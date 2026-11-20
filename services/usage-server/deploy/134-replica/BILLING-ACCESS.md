# Sub2Agent 账单服务访问与签名方案

> 部署位置：134.175.165.190（本文件在服务器上的路径：`/root/BILLING-ACCESS.md`）
> 密钥与凭据一律不写入本文档。

## 访问入口

- 服务地址：`http://134.175.165.190:5173/`
- 健康：`GET /healthz`（无需签名，浏览器可开）
- 账单报告（需签名）：
  - `GET /users` — 用户目录
  - `GET /reports/<user>/daily.json|svg|png` — 日报
  - `GET /reports/<user>/weekly.json|svg|png` — 周报
  - 可选 `?date=YYYY-MM-DD`，缺省当天
- 未签名访问报告一律 **401**（设计行为）

## 签名方案（与 0.177 完全一致）

待签字符串（四行，UTF-8，`\n` 分隔）：

```
sub2agent-billing-v1
{METHOD，如 GET}
{请求目标：路径+query，与实际请求逐字节一致}
{13位毫秒时间戳}
{32位小写hex随机数(16字节)}
```

签名：`HMAC-SHA256`，密钥为**签名密钥文件的 hex 解码后的 32 字节**，输出 64 位小写 hex。

三个请求头：

| 头 | 值 |
| --- | --- |
| `x-sub2agent-timestamp` | 13位毫秒时间戳，与服务端时钟差 ≤5 分钟 |
| `x-sub2agent-nonce` | 32位小写hex，窗口内不得重复（防重放） |
| `x-sub2agent-signature` | 64位小写hex |

## 密钥位置

- 134：`/etc/sub2agent/billing-signing.key`（root-only 0600）
- 0.177：`/etc/sub2agent/billing-signing.key`（同一把）
- 桌面客户端构建时经 `build/intranet.ps1 -BillingKeyFile <path>` 注入
- 严禁写入日志、URL、截图、仓库

## 服务器本机一条命令出账单（134）

签名客户端已部署在 `/usr/local/sbin/bill`（root 可用，密钥从本机读取）：

```bash
bill <user>                    # 今日 daily.json -> stdout
bill <user> 2026-11-18         # 指定日期
bill <user> 2026-11-18 svg     # SVG 卡片 -> stdout
bill <user> 2026-11-18 png     # PNG -> /tmp/bill-<user>-<date>.png
```

## 从管理机（Windows）签名访问

```powershell
$target = '/reports/<user>/daily.json?date=2026-11-18'
$ts     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$nonce  = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
$hexkey = (Get-Content <key文件路径> -Raw).Trim()
$bytes  = -split $hexkey -replace '^','0x' | ForEach-Object { [byte]$_ }
$hmac   = [System.Security.Cryptography.HMACSHA256]::new($bytes)
$msg    = "sub2agent-billing-v1`nGET`n$target`n$ts`n$nonce"
$sig    = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg)) | ForEach-Object { $_.ToString('x2') })
Invoke-RestMethod "http://134.175.165.190:5173$target" -Headers @{
  'x-sub2agent-timestamp'=$ts; 'x-sub2agent-nonce'=$nonce; 'x-sub2agent-signature'=$sig
}
```

Linux bash（注意密钥必须 hex 解码为 32 字节，用 `-macopt hexkey` 而不是 `-hmac <字符串>`）：

```bash
TS=$(date +%s%3N); NONCE=$(openssl rand -hex 16); HEXKEY=$(cat /etc/sub2agent/billing-signing.key)
TARGET="/reports/<user>/daily.json?date=2026-11-18"
SIG=$(printf 'sub2agent-billing-v1\nGET\n%s\n%s\n%s' "$TARGET" "$TS" "$NONCE" \
  | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HEXKEY" | awk '{print $NF}')
curl -s -H "x-sub2agent-timestamp: $TS" -H "x-sub2agent-nonce: $NONCE" \
     -H "x-sub2agent-signature: $SIG" "http://134.175.165.190:5173$TARGET"
```

## 参考实现

- 服务端校验：`services/usage-server/src/billing-auth.js`
- 客户端示例（两台机器验证用）：`services/usage-server/deploy/134-replica/verify-report.js`
- 签名规范：`docs/subsystems/accounting.md` *Signed billing queries*
- 部署与同步架构：`services/usage-server/DEPLOYMENT-134.md`
