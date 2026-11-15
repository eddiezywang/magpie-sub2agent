# 工作台阶段验证 · 2026-11-16

分支：`feature/intranet-routing-workspace`。本记录不代表所有任务完成。

## 已执行

- 内网 Go 定向测试通过：`TestCodingPlan`、`TestWorkspaceThroughput`、`TestCoreScriptBudget`、`TestInternalIndex`、`TestSessionCurve`，覆盖 provider/gui/gateway/assetpack。
- `build/workspace-acceptance.cjs` 在 Chromium 和 WebKit 通过：默认折叠与按钮位置、批量部分失败后仅失败重试、离页停止剩余写入并清除进度、目标 Agent 路由组保存与其他 Agent 不变、三个吞吐量维度和中断保留数据、保留页面导航及页面脚本错误检查。
- 1440/1024/390 × 浅/深色 × 两种浏览器截图，未发现页面横向溢出。截图是打包后的生产前端配合明确隔离的合成接口；不将 fixtures 注入正式产品。
- `build/intranet.ps1 -WithoutBun` 实际 Windows 构建通过，输出在工作区外 `workspace-builds/sub2agent-windows-x64-20261116-011024`。运行时使用 `.portable` 及独立 HOME/USERPROFILE/APPDATA/XDG，并清除 agentenv.Vars；网关 19893，页面 19894，原应用进程保持独立。
- `build/workspace-runtime.cjs` 通过实际程序的 10 个保留页面和真实 180 点接口；本机合成上游交付 7 次 SSE 输出后出现正数吞吐量，并包含供应商、模型和会话归属。未调用真实供应商账号；本验证不能替代真实 Agent 客户端接入验收。
- 阶段截图已发布：[工作台审查页](http://124.220.199.224:8805/workspace-review-20261116/)。Playwright 核对页面 HTTP 200、13 张截图均可访问；归档 SHA256 `317d111e85fbd3b731968fd250edf86c34cf31d8c658485208eed33dd0c77098`。仅上传截图和脱敏结果，没有运行目录、认证 Cookie 或密钥。

## 待解决和继续验证

- 全量 `go test -tags 'nogui,intranet' ./...` 已启动；`TestSenderAgainstRealSummaryServer` 报汇总为零，其余完整结果待收集，不能声称全量通过。
- 广泛的 `TestLive` 筛选命中了 provider 的 `TestLiveSinceCarriesOver`，其 Codex fixture 未找到 provider；待核对内网供应商限制与原测试的关系。独立的工作台定向测试通过。
- race 尚待 Windows C 编译器准备完成后执行。
- 仍需完整验证键盘、原生 Agent 接入异常适配、模型选择保留、供应商认证/草稿保护、路由组持久化及实际请求、所有者转发和未知校准边界。
- 仍需全语言 GUI 回归、上下游构建/vet和核心资产范围审计；未勾选的组合任务保持未完成。
