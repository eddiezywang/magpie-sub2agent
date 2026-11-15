# 工作台阶段验证 · 2026-11-16

分支：`feature/intranet-routing-workspace`。本记录不代表所有任务完成。

## 已执行

- 内网 Go 定向测试通过：`TestCodingPlan`、`TestWorkspaceThroughput`、`TestCoreScriptBudget`、`TestInternalIndex`、`TestSessionCurve`，覆盖 provider/gui/gateway/assetpack。
- `build/workspace-acceptance.cjs` 在 Chromium 和 WebKit 通过：默认折叠与按钮位置、批量部分失败后仅失败重试、离页停止剩余写入并清除进度、目标 Agent 路由组保存与其他 Agent 不变、三个吞吐量维度和中断保留数据、保留页面导航及页面脚本错误检查。
- 原生 Agent 可见性回归 `agent-bulk-visibility.test.cjs` 和 `agent-visibility-saving.test.cjs`：Chromium/WebKit 共 22 项通过，包含五种语言、批量隐藏/恢复、失败重试、旧状态和跨窗口刷新。此项不等于新增批量接入的全语言验收。
- 补充共享写锁后，两个浏览器均验证：单行接入期间批量按钮禁用，批量期间模型保存不发请求，成功后恢复写入；原有工作台交互、离页停止和六种布局再次通过。模型保存辅助函数移入既有 Agent 模块，核心脚本体积检查通过。Agent 接入状态改变会同步刷新路由目标，吞吐量启动不再等待路由组查询。
- Chromium/WebKit 额外通过首次默认工作台、上次 Agent 页恢复、显式路由深链、Enter 展开/收起、不可用预定义组禁用、手工组不出现在快捷项、无组提示，以及接入状态变动后目标提示更新。
- 1440/1024/390 × 浅/深色 × 两种浏览器截图，未发现页面横向溢出。截图是打包后的生产前端配合明确隔离的合成接口；不将 fixtures 注入正式产品。
- `build/intranet.ps1 -WithoutBun` 实际 Windows 构建通过，输出在工作区外 `workspace-builds/sub2agent-windows-x64-20261116-011024`。运行时使用 `.portable` 及独立 HOME/USERPROFILE/APPDATA/XDG，并清除 agentenv.Vars；网关 19893，页面 19894，原应用进程保持独立。
- `build/workspace-runtime.cjs` 通过实际程序的 10 个保留页面和真实 180 点接口；本机合成上游交付 7 次 SSE 输出后出现正数吞吐量，并包含供应商、模型和会话归属。未调用真实供应商账号；本验证不能替代真实 Agent 客户端接入验收。
- 最新实际构建 `sub2agent-windows-x64-20261116-014722` 已重新启动：原生批量按钮实际写入独立 HOME 中的 Claude/Codex 配置，保留已有 qa-model 选择；工作台选择真实预定义 `group/never-stuck` 后等待写入结束再刷新，选择持久化且 Codex 不变，经该组的实际流式请求成功。使用 `build/workspace-launch.ps1` 可复现启动隔离与独立认证，`qa-web-key.txt` 只留在本机运行目录。
- 吞吐量补充可控时钟测试覆盖启动前 null、固定换算不回写历史、180 秒淘汰、独立峰值、128 供应商/512 模型上限与总量保留、新进程 epoch；所有者测试明确断言内网 LAN 403 / 本机 200，并覆盖旧版本、空序列、坏 JSON 和上下文超时。gateway/gui 工作台测试再次通过 Windows race。
- 两个浏览器补充通过未校准数值/曲线断点、epoch 后峰值重置、1.8 秒慢响应不重叠、后台暂停/恢复、离页中止查询与停止后续调度。
- 阶段截图已发布：[工作台审查页](http://124.220.199.224:8805/workspace-review-20261116/)。Playwright 核对页面 HTTP 200、13 张截图均可访问；归档 SHA256 `317d111e85fbd3b731968fd250edf86c34cf31d8c658485208eed33dd0c77098`。仅上传截图和脱敏结果，没有运行目录、认证 Cookie 或密钥。

## 待解决和继续验证

- 首次全量 `go test -tags 'nogui,intranet' ./...` 失败，后半段存在 C 盘临时目录耗尽引起的创建失败；不能作为功能验收。将 TEMP/TMP/GOTMPDIR 全部切到 D 盘后，以 `-p 2 -timeout 15m` 重跑已结束，仍有大量旧供应商内网隔离断言、Windows shell 缺失等失败，以及 gateway 的 Antigravity 旧 fixture panic；不能声称全量通过。`TestSenderAgainstRealSummaryServer` 在独立 D 盘重跑仍报汇总为零。
- 广泛的 `TestLive` 筛选命中了 provider 的 `TestLiveSinceCarriesOver`，其 Codex fixture 未找到 provider；待核对内网供应商限制与原测试的关系。独立的工作台定向测试通过。
- 在实现前基线 `903b04330` 的独立 worktree 重跑上述 accounting 和 Codex 两个失败，均以相同断言失败，证实两项失败已存在于工作台实现之前；仍不将它们记作通过。
- 原生断开、模型选择、供应商草稿 GUI 回归共 22 项中 18 项通过；4 项断开预览测试在实现前基线也以相同 `Sub2Agent != magpie` 品牌断言失败。后端原生 AgentConnectAPI 通过；广泛 Disconnect 筛选另命中 3 项旧插件恢复 fixture 失败，已在 `903b04330` 基线复现相同断言。
- Windows LLVM-MinGW 编译器准备后，`go test -race -tags intranet ./internal/gateway ./internal/gui -run '^TestWorkspaceThroughput' -count=1` 通过。未校准且无有效历史的峰值现返回 null，防止显示为数值零；补充断言并再次通过 race。
- 仍需完整验证键盘、原生 Agent 接入异常适配、模型选择保留、供应商认证/草稿保护、路由组持久化及实际请求、所有者转发和未知校准边界。
- 仍需全语言 GUI 回归、上下游构建/vet和核心资产范围审计；未勾选的组合任务保持未完成。
