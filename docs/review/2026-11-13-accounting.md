# 用量采集与旧埋点兼容：客户端验收记录

构建：`0.1.3913-sub2agent.6`，源码 `e0f38e4`，2026-11-13。
运行目录保留原有 data，只替换程序；网关 8989，浏览器页面 8990。
原版 Magpie 仍在 3425，未替换原版程序或凭据。

## 已实现

- 旧 `/events` 单对象协议、事件名、Windows 平台值与退出开关兼容。
- 新网关数值用量独立投影，不捕获请求或响应正文；保留缓存、重试交接和实际模型。
- 持久 outbox、离线重试、逐事件确认、拒绝事件归档与容量限制。
- 内置插件设置：旧埋点默认开启，新用量默认关闭；保存后替换旧发送器。
- 共用开关样式从资源库移回 app.css，修复精简后开关不可见的问题。

## 验证结果与范围

| 检查 | 结果 |
| --- | --- |
| accounting 与 pluginrt 完整包测试 | 通过，隔离 HOME，采集器为 loopback fixture |
| Linux `-race -tags nogui`，上述两个包 | 通过；在独立临时源码目录运行 |
| 内网配置 `go vet -tags production,packedassets,intranet ./...` | 通过 |
| GUI 资源、内网注册、脚本预算、插件设置翻译 | 通过 |
| i18n 键重复、归属、语言完整性和窗口字符串 | 4 项通过 |
| Chromium 与 WebKit 内网 shell 回归 | 各 5 项通过，包含开关浅/深色与切换 |
| 配置重启测试撤回修复 | 按预期失败：仍是 old URL；恢复修复后通过 |
| 开关样式测试撤回修复 | 按预期失败：透明轨道；恢复修复后通过 |
| Windows 原生生产构建与启动 | 通过；运行文件 SHA-256 与新构建一致 |
| 运行实例 Playwright 只读检查 | 通过；4 行配置、开关可见、会话入口保留、无脚本异常 |
| Windows `go test -tags nogui ./... -timeout 90s` | 未通过，存在失败与超时，不能声称全套通过 |

全量运行中失败的包为：build/darwin、internal/agent、appdir、backup、
browsermcp、catalog、claudetui、cli、davsync、gateway、gui、library、
plugin、provider、sessions、settings、shortcut、sqlitedb、update、usage。
其中 Darwin footprint 用例在 Windows 找不到 sh；加入 Git shell 后，
生成的 POSIX `/tmp` overlay 路径仍无法被 Windows Go 读取。其他失败
尚未逐项定位或与修改前版本比较，不能全部归因于环境或上游。
本次修改直接相关的包与 UI 检查通过，不代表上述全量问题已解决。

## 尚未验证或实现

当前环境未能连接 `172.21.0.177:17890/events`，启动埋点留在本机队列，
没有将 HTTP 失败视为成功；真实旧服务落库尚未验证。
旧服务未按新增事件 ID 去重前，断线重试属于至少一次投递。

现有 usage-server 源码和访问方式尚待提供。服务端 v2 适配、价格表、
计价、Totals/day 报告与图片生成尚未接入，不能把客户端完成视为账单上线。
新用量默认关闭，需服务端声明 v2 能力并逐事件确认后才可投递。

应用启动按进程记录，网关停用记录 stop 和末段时长；不会把插件重载
误报为 app_quit。后续补齐原生应用 OnShutdown 的退出事件，持久化一次
desktop_app_quit，下一次启动重试。强制终止进程无法生成最后的退出事件。
真实供应商推理、服务端价格计算与计费一致性未验收。

离线 ZIP：73,124,291 字节（约 69.7 MiB），不含用户 data。
SHA-256：`1acf64a67dcfd9737a53e73b7cdf50a5c1ee08d50765e47fbeb9162e200e3e89`。

截图使用 Playwright，仅含设置，不包含账户、密钥或对话。
