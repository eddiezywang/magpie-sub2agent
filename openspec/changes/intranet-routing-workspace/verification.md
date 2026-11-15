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
- 第二轮更新审查页，新增真实程序展开 Agent 截图并更新运行证据，Playwright 核对 14 张图均 HTTP 200。当前发布归档 SHA256 `cddef570724241e72774ff738e06b0cf63c4576d84a20847101dbf3dbcb2b826`；目录仍不含运行数据、密钥和日志。

## 待解决和继续验证

- 首次全量 `go test -tags 'nogui,intranet' ./...` 失败，后半段存在 C 盘临时目录耗尽引起的创建失败；不能作为功能验收。将 TEMP/TMP/GOTMPDIR 全部切到 D 盘后，以 `-p 2 -timeout 15m` 重跑已结束，仍有大量旧供应商内网隔离断言、Windows shell 缺失等失败，以及 gateway 的 Antigravity 旧 fixture panic；不能声称全量通过。`TestSenderAgainstRealSummaryServer` 在独立 D 盘重跑仍报汇总为零。
- 广泛的 `TestLive` 筛选命中了 provider 的 `TestLiveSinceCarriesOver`，其 Codex fixture 未找到 provider；待核对内网供应商限制与原测试的关系。独立的工作台定向测试通过。
- 在实现前基线 `903b04330` 的独立 worktree 重跑上述 accounting 和 Codex 两个失败，均以相同断言失败，证实两项失败已存在于工作台实现之前；仍不将它们记作通过。
- 原生断开、模型选择、供应商草稿 GUI 回归共 22 项中 18 项通过；4 项断开预览测试在实现前基线也以相同 `Sub2Agent != magpie` 品牌断言失败。后端原生 AgentConnectAPI 通过；广泛 Disconnect 筛选另命中 3 项旧插件恢复 fixture 失败，已在 `903b04330` 基线复现相同断言。
- Windows LLVM-MinGW 编译器准备后，`go test -race -tags intranet ./internal/gateway ./internal/gui -run '^TestWorkspaceThroughput' -count=1` 通过。未校准且无有效历史的峰值现返回 null，防止显示为数值零；补充断言并再次通过 race。
- 仍需完整验证键盘、原生 Agent 接入异常适配、模型选择保留、供应商认证/草稿保护、路由组持久化及实际请求、所有者转发和未知校准边界。
- 仍需全语言 GUI 回归、上下游构建/vet和核心资产范围审计；未勾选的组合任务保持未完成。

## 合并 main 后的便携构建 · 2026-11-16 02:26

- 将 `fork/main` 的 `a04143978` 合并到当前功能分支，合并提交 `c0712c51ff7f8882def1b67783774d275a3eae48` 已推送；无冲突，保留工作台功能和 Agent 内容区顶部的批量按钮。
- 合并结果通过 Agent 当前模型优先/Claude 路由组、GUI 供应商模型等待/throughput/核心脚本体积、gateway throughput、内网三源更新和 distribution 定向 Go 测试。重新生成测试运行时后供应商 Node 测试 19/19 通过；域名同步测试通过，app.js 语法及 diff whitespace 检查通过。
- 完整 `internal/update` 内网标签测试存在上游 CLI 名称及公共更新通道假设不适用于内网版的失败，不能记作全量通过。
- `build/intranet.ps1 -BunArchive .../bun-windows-x64-baseline-1.4.2.zip` 生成完整 Windows x64 便携包 `sub2agent-windows-x64-20261116-022615.zip`，含 Bun，73,272,417 字节，SHA-256 `0c894f1f57267ecf50fd593ef812f2be22464d31e33023055ba78b32c04383f2`。清单 sourceCommit 为 c0712c51f；workingTreeChanges=true 由用户既有未跟踪 .github 目录导致，构建时已跟踪源码无未提交差异。
- 合并后的 packed-assets Chromium/WebKit 工作台回归再次全部通过。实际新程序在隔离 HOME 和 portable data 启动，10 个保留页面无脚本错误；Claude/Codex 原生接入、真实预定义组持久化及 8 次本机合成流式响应验证通过，180 点接口含正数及供应商/模型/会话归属。首次运行验证期间统计读取返回暂时不可用，等待后完整重跑通过；该次未记为通过。
- 审查页已更新为此构建截图；Playwright 验证 14 张图片均 HTTP 200，页面含合并版本。只上传截图和脱敏 JSON，归档 SHA-256 `0461c86de9c34f7f201b47568fcd74898d034c8f2ca7b09875345a3fbfbf356e`。
- 便携包已按用户要求经本机 → laptop → 个人 iDisk → KF 传输，三端 ZIP SHA-256 一致。laptop 路径 `C:\Users\eddiewang\Downloads\sub2agent-windows-x64-20261116-022615.zip`；KF 压缩包和解压目录位于 `C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-022615`。KF 已独立计算 ZIP 摘要，并逐一验证 manifest 中 55 个文件的 SHA-256，均一致；应用未在 KF 自动运行，原有安装未覆盖。

## 工作台原生多语言验收

- 新增内网 workspace-i18n.js，通过原生 magpie.strings 注册四种翻译；工作台、Agent 批量接入进度、吞吐量状态与曲线可访问名称均使用原生 t()/data-t，时间显示使用当前语言。共享 Workspace 和未识别会话词条放在 core i18n.js，不重复注册。
- 翻译守卫纳入独立内网字典，排除不属于产品源码的 .github 工具配置；四项 i18n-keys 测试全部通过（重复词条、各语言键集、词条归属、词条存在性）。
- packed-assets Chromium/WebKit 原有工作台验收及新增五语言检查均通过：导航/页标题、Agent 内容顶部批量按钮、待校准状态、维度曲线和 1024 宽无横向溢出。资产打包测试、核心脚本体积测试及语法/空白检查通过。
- 将新增浏览器检查指向修改前 c0712c51f 的生产资产，实际失败于 English Workspace 标题仍为“工作台”，证明本次检查能检出原缺陷；不是仅检验字典内容。
- 这项修补晚于已送达 KF 的 c0712c51f 便携包；KF 包仍对应该合并提交，不能将此源码修补描述为已交付。

## 草稿与路由组异常流程验收

- `TestWorkspaceDeletedGroupDoesNotRewriteAgent` 在修复前实际返回 HTTP 200，复现删除组仍能提交的缺陷；内网 `/api/set` 现于 Agent.Pick 之前用 provider.FindGroup 拒绝已删除/禁用组，错误通过原生字典翻译。有效组仍经原生写入；拒绝后 Codex 配置字节不变。普通 Go 与 Windows race 均通过，原生 AgentConnectAPI/核心体积回归通过。
- Chromium/WebKit packed-assets 新增验收通过：原生供应商草稿取消离页保持、确认丢弃无保存请求、独立页/工作台唯一 DOM 宿主恢复、路由组管理跳转及返回；错误组保存回滚、延迟保存后目标保持 Pi、旧组读取不能覆盖更新后的组。时间相关检查通过显式挂起/释放请求同步，不以定时等待猜测完成。
- 新错误词条四种翻译及既有 i18n-keys 四项守卫通过。全工作台浏览器回归（含五种语言、浅深色及窄屏、轮询生命周期）再次通过。

## 03:15 修补构建与交付

- 当前应用源码 `7b7f5c598e8bd352ce737d479286a9cec37fd811` 完整便携构建通过，含 Bun。`sub2agent-windows-x64-20261116-031506.zip` 为 73,273,641 字节，SHA-256 `ca1bbf2d9768ec7da9d4fc429c6d6d1714266c874db7099f578ec700cc5b42ae`。Windows 内网、Linux 内网和 Windows 上游 `go vet -tags nogui ./...` 均 exit 0。
- 本地隔离程序 PID 40256，页面 19894/网关 19893；10 页无脚本错误，真实合成上游 8 次响应、180 秒正数归属曲线、路由组持久化/实际请求和 Agent 配置隔离再次通过。生产资产没有 design-preview/workspace-fixtures 文件，工作台脚本不引用 iframe 或演示接口。运行验证脚本现兼容网关所有者启动/重载期间合法的 unavailable 响应，只在实际正数快照出现后成功，15 秒内无数据仍失败。
- 最新截图与脱敏结果已更新审查页，Playwright 核对 14 张图 HTTP 200、页面构建版本 7b7f5c598。上传归档 SHA-256 `8cf1346efeb2d210674127f76a9a73de218af120a1b8ddb32025e27624b7d3e9`。
- 新包已再次经 laptop → 个人 iDisk → KF。三端 ZIP 摘要一致，KF 解压后 55 个清单文件摘要逐一通过。KF 可执行文件：`C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-031506\sub2agent-windows-x64-20261116-031506\sub2agent.exe`。此包包含五语言修补和路由组删除保护；未覆盖旧包，未在 KF 自动启动。

## Agent 未知状态恢复

- 修复读取 `/api/agents/connections` 失败后沿用旧行却计作已接入/未接入的问题：保留行统一标为未知、原生状态点不再绿色、未知对象不进入批量候选或路由组目标；缺失单行检查也按未知处理。展开的 Agent 工具区提供原生“重新检测”，不添加重复行说明；失败访问不会因重绘自动循环重试。
- Chromium/WebKit packed-assets 验证单行未知计数 2/7/1、全量读取失败计数 0/0/10、批量禁用和路由目标回收、无重复 connection-check、两次重绘无自动读请求、显式重检恢复 2/8 与 8 个候选。原有全部工作台检查同时通过。
- 同一新增检查指向修复前的真实生产资产时失败：读取失败后未出现“未知 10”，证明能检出原缺陷。此修补为源码后续，尚未替换 KF 的 03:15 应用包。

## Latest main merge (2026-11-16 03:47)

Merged fork/main 0372636b4 without conflicts. Updated isolated review launcher
for the new explicit XDG_CONFIG_HOME/sub2agent configuration; .portable no
longer isolates internal builds. Targeted workspace/curve/model tests pass,
appdir suite passes with native Windows temporary paths, and settings migration
checks pass. The full settings suite is not green: issue tracked locally below.

### Open verification issue: Windows settings allocation threshold

TestSharedCheckedReadsOnceAndKnowsUnknown fails on Go 1.26.8 Windows intranet:
14 allocations for SharedChecked vs 31 for LoadChecked (threshold <=6 and 4x).
Even settling file time gives 11 vs 28; path caching does not resolve this.
Experimental changes were reverted. The observed read/copy allocation assertion
fails; no production optimization or raised threshold has been shipped.
GitHub issue lookup is unavailable because gh is not installed. This remains
an explicit verification limitation; do not describe the full suite as passing.

### Latest merged-main package 034732

Built source 14017f165569f179b723c8bd09c4ee3e9843774d, including main
0372636b4, with clean tracked inputs (untracked .github agent tooling excluded).
ZIP: sub2agent-windows-x64-20261116-034732.zip, 73,276,075 bytes,
SHA256 528235ce71006390fb7058fb7cc2c79c92906935d8a2b25410d8e5681b369df9.
Fresh isolated XDG runtime PID 47980: 10 retained pages, zero script errors,
actual streamed output and native routing group persistence passed in Chrome.
Updated runtime verifier reads the observed snapshot explicitly after readiness;
this script-only change is not application code and does not alter the package.
Review screenshots were replaced with this actual native build, synthetic data
only. Full settings allocation assertion remains a documented limitation above.

Delivery completed through laptop -> personal iDisk -> KF. Both remote ZIPs
match local SHA256 528235ce71006390fb7058fb7cc2c79c92906935d8a2b25410d8e5681b369df9.
KF extracted all 54 manifest files and verified each hash. Executable:
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-034732\sub2agent-windows-x64-20261116-034732\sub2agent.exe
KF was not auto-launched. Review site returned HTTP 200 after screenshot update.

### Bulk candidate and result follow-up

Fixed missing-CLI Agents entering bulk connect and partial-failure redraws
replacing the count summary with only errors. Packed current assets verified in
Chrome and WebKit: candidates omit missing CLI, no connect request targets that
Agent, failed batches retain 7 success/1 failure/0 skipped plus Codex error,
retry succeeds. Both engines also passed existing unknown snapshot, shared write
locks, leave cancellation, supplier draft preservation, group save races, all
five locales, six workspace layouts, and telemetry lifecycle checks.
The standalone 034732 delivered bundle predates this follow-up; rebuild is
required before representing these two fixes as delivered.

Latest current-head race run passed TestWorkspace*, TestSessionCurve*, TestModelSpeeds*, TestModelLoads* in gateway and GUI. Reviewed tests cover all 4.6/4.7 cases, including retry attribution, distinct same-named models, owner/held-key/LAN rejection and Sessions compatibility. Core script budget and all four i18n guards also passed. Tasks 4.6/4.7 are now checked; broader native operation and full acceptance gates remain unchecked.

### Bulk follow-up packaged review (04:05)

Current production source 135d0c36e. Build sub2agent-windows-x64-20261116-040524.zip
is 73,276,101 bytes; SHA256
9e7fee46a3088e75932969a16d3720d8950c44a1385371b44f1f950d9358e6c9.
Started isolated runtime PID 6720. Actual ten-page Chrome checks passed with
positive calibrated loopback output and native group save/persistence/request.
Final packed Chrome/WebKit run passed after the last snapshot-presence guard.
The verifier now polls and retains one validated API response in Node, avoiding
ambiguous asynchronous waitForFunction return serialization and a second read.
Updated sanitized review screenshots at workspace-review-20261116; inspected
actual runtime-throughput.png visually after trusted wheel scrolling. Confirmed
HTTP 200 and review source 135d0c36e. No real supplier accounts were used.

04:05 package delivered local -> laptop -> personal iDisk -> KF. Both remote
ZIPs matched 9e7fee46a3088e75932969a16d3720d8950c44a1385371b44f1f950d9358e6c9;
KF verified all 54 extracted files against the source 135d0c36e manifest.
KF executable (not auto-started):
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-040524\sub2agent-windows-x64-20261116-040524\sub2agent.exe
The earlier 034732 bundle remains separate; use 040524 to review these fixes.

### Workspace provider operation audit

Added build/workspace-providers-acceptance.cjs against the actual packed internal
assets, sharing the isolated fixture entry point without running other suites.
Chrome and WebKit passed TIG/CIB names/logos, custom provider detection/add,
turn off/show folded disabled list/turn on, refused edit retaining draft then
retry, standalone Providers synchronization, native plugin sign-in prompt,
callback and successful account editor. Authentication used synthetic local API
responses only; no real credentials, real vendor or callback was accessed.
Both 1440 and 390 check the authentication input fits its panel. Local auth
screenshots are diagnostic only and must not be published. Add-sheet screenshot
inspection found its narrow-column header wrapping the title to single glyphs;
this visual defect remains to fix before checking task 2.3.

Provider narrow-header fix verified in both engines at 1440/1024/390. Title
stays on one line; search/actions stay within the sidebar. Old packed assets
fail the new title assertion at 1440, establishing the regression. Current
screenshots inspected visually. Native operation coverage above and verified
native logo/name source complete task 2.3, with live-vendor auth explicitly
unverified. Only this scope is checked; other acceptance tasks remain open.

### Retained page layout matrix

build/workspace-pages-acceptance.cjs passed 120 cases: both Chrome and WebKit,
light/dark, 1440/1024/390, all ten retained pages (workspace, Agents, Providers,
Routing, Groups, Gateway, Sessions, Usage, Plugins, Settings). Checks visible
named surfaces, one native host, no document viewport overflow or script errors,
and keyboard activation of Agent disclosure and all throughput dimensions.
This completes the page/layout/keyboard matrix task 5.4; synthetic APIs do not
prove each retained page's complete operation set (task 1.4 stays open). Native
runtime capture separately covers all ten pages in the actual Windows package.

043758 package source 7d11613aa; zip 73,275,720 bytes, SHA256
7be4857d6091044ccfac937e78d485b600cdbed8a8fe4e0a848f6f70ecabdce8.
Isolated native runtime PID 11448 passed ten-page, group save/reload/request,
positive delivered throughput and TIG preset checks. Public gallery updated to
7d11613aa and includes the inspected Add sheet screenshot. Only selected public
files were uploaded; private-auth stays local and is excluded from publication.

043758 delivery complete: local -> laptop -> personal iDisk -> KF. Remote ZIP
hashes match 7be4857d6091044ccfac937e78d485b600cdbed8a8fe4e0a848f6f70ecabdce8;
KF verified all 54 extracted manifest files. Application remains unlaunched there:
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-043758\sub2agent-windows-x64-20261116-043758\sub2agent.exe
Actual package Add sheet also verified native TIG/CIB names and image assets,
then captured runtime-provider-add.png and inspected it before publication.
No authentication screen was published. Local runtime 11448 remains available.

### Clean merged build delivery 050727

Fetched fork/main at 0372636b4 and verified it is already an ancestor of the
workspace head. Built clean detached worktree 9d41908e8 (workingTreeChanges
false), excluding in-progress changes in the original checkout. ZIP SHA256:
0eec2a06af87521e4c9674b5f87edef5349c2e2bf42d0047d05d718dfa27b839.
Isolated Windows runtime PID 53604 replaces the earlier QA runtime. All ten
pages, seven streamed loopback replies, attributed 180-point throughput,
group persistence/request and TIG preset checks passed. Core script budget
passed. Selected Playwright captures published at
http://124.220.199.224:8805/workspace-review-20261116/delivery-050727.html.
Laptop and KF ZIP hashes match; KF verified all 54 manifest files. KF executable:
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-050727\sub2agent-windows-x64-20261116-050727\sub2agent.exe
It has not been launched there. This is targeted verification, not a claim
that the previously recorded full-suite failures have been resolved.

### Route focus and native adaptation follow-up

Both Chromium and WebKit passed workspace-focus-acceptance.cjs: retain focused
controls during pending reads, restore matching focus on replacement, retain
controls and status on read failure, preserve another surface's open menu,
ignore moved focus and departed pages, and fall back when a group or target
disappears. Existing unmanaged connections now use the native status/switch
without an additional adaptation button; workspace-acceptance checks that
one native switch performs exactly one connect write. The fixture resets its
authoritative Agent object before subsequent unknown-snapshot cases.

Full packed workspace interaction suite passed both engines after these edits,
including all five languages, six layouts, failure/retry, write locks, unknown
snapshots, stale routing reads, draft guards and telemetry lifecycle. JS syntax,
whitespace and TestCoreScriptBudget passed. Clean 13dfe951b package 052224 was
built and launched in isolation (PID 22932). Its actual Windows runtime passed
the ten-page/streaming/group persistence checks again. Agent screenshot inspected:
bulk control is in Agent content and redundant connection rows are absent.
Selected screenshots are at
http://124.220.199.224:8805/workspace-review-20261116/focus-052224/focus-052224.html
The 050727 bundle remains the last verified KF delivery; 052224 is local only.
Its ZIP SHA256 is ae0df61eeabe58e43b96f41a46ac1a7bd5a45703fba642d73cd71102198a6fb6.
Open tasks 1.3/1.4/2.6/2.7/2.8/5.5/5.6 still require their complete stated scope;
the targeted checks above do not close those broader gates.

### Bulk model-list recovery

The bulk queue now recovers all_hidden using the original Agent model list,
waiting for its native save/close lifecycle. Unchanged close skips just that
Agent and continues; changed close retries once; navigation stops the rest;
model-list read failure stays failed. Menu anchors follow toolbar redraws.
workspace-bulk-models-acceptance.cjs passed cancel/pick/leave/read-error in
Chromium and WebKit. The existing packed workspace suite passed both engines
before the final read-error distinction; the final dedicated suite and
TestCoreScriptBudget/TestAgentConnectAPI/TestWorkspaceDeletedGroupDoesNotRewriteAgent
passed afterward. TestAgentConnectAPI verifies the backend retains an existing
model on first connect and does not change it on reconnect. Broader native
model-menu regression and remaining OpenSpec scopes are tracked separately.

The final dedicated bulk suite additionally passed a hidden candidate row and
delayed model-list save before retry, proving queue membership is independent
of rendered rows and connect waits for the native save. The four upstream
native model-menu suites (all-hidden, no-models, loading, redraw) passed all
34 cases. workspace-agent-status-acceptance.cjs passed both engines on both
workspace and standalone Agents: one native bad status, diagnostic tooltip,
working How to fix details, and no duplicate connection-check/adapt element.
Combined with the preceding unknown/adaptation, bulk failure/retry/locks,
candidate, lifecycle, native backend model-retention checks and inspected
Agent content screenshots, tasks 2.6/2.7/2.8 are now verified. Other open gates
remain open; no full-suite green claim is made.

Clean 52306cd75 Windows bundle 053640 built and launched in isolation as PID
32196, replacing the older QA process only. Actual runtime ten-page checks,
seven loopback streamed replies, 180-point attributed throughput and routing
group save/reload/request passed. Agent screenshot inspected; selected safe
screenshots published (HTTP 200):
http://124.220.199.224:8805/workspace-review-20261116/bulk-053640/bulk-053640.html
ZIP SHA256: f07fb4ed2f626021be69f714b7727b397a5623d9eb3007725687661f798ea26f.
This build is local; KF still has the separately verified 050727 delivery.

### Lifecycle and reference audit

workspace-lifecycle-acceptance.cjs passed Chromium and WebKit against the
packed 52306cd75 assets: six workspace/Agent round trips, exactly one live
Agent observer while active, zero after leave, no callbacks from mutations
after leave, unique native Agent/Routing/Providers trees, and final Sessions
navigation. Together with the recorded draft cancel/discard, focus, stale-read,
background/leave abort and paused-queue tests, this completes task 1.3.
Routing's own visibility listeners/long poll remain the original native
lifecycle, not an extra workspace subscription.

Task 5.6 references audited against workspace.js, workspace-throughput.js,
workspace_throughput.go, workspace_throughput_http.go, GUI route registration,
native group saving, internal_config.go and workspace-launch.ps1. GUI lifecycle,
routing scope, exact bucket/current/peak/null semantics, first-snapshot/output
epoch, dimension eviction, owner response limits and access restrictions, QA
commands, shared configuration and rollback are now documented in their owning
references. No application code changed in this documentation/lifecycle step.
Full retained-operation regression (1.4) and broader test gate (5.5) remain open.

### Broader test pass at 114cd19c4

`go test -tags intranet ./internal/gui -count=1 -timeout 240s` is terminal red,
not a successful full-package check. Local log:
../.build-tools/workspace-gui-full-114cd19.log. It reports upstream assumptions
about removed Library/Bark/builtins/public providers, Codex routing-group fixture
failures, TestFXStateDoesNotWait waiting for a disabled refresh, a Windows
gateway helper cleanup failure, and timeout while TestProviderSaveModelPrefs
was running. Accounting goroutines also referenced an earlier deleted test
home. These findings require test/profile and lifecycle investigation before
closing 5.5; they are not explained away as environmental timing.

Packed plugin-intranet-offline browser regression initially exposed an image
assertion race: the card exists before its SVG has loaded. The test now waits
for image completion and still asserts positive naturalWidth, so missing/broken
assets fail. Its full six Chromium/WebKit cases pass at desktop/light and
narrow/dark, including timeout, retry, HTTP 503, healthy empty directory, cached
catalog, pixel icon and omitted privacy settings. No product code changed.

### Profile-specific GUI test corrections

The three Codex auto-discovery group cases are upstream-only because internal
provider.Accounts intentionally reads plugin accounts alone. Their sign-in
fixture now lives in a common helper. The new intranet negative test uses that
same complete fixture (valid synthetic JWT/cache/live model list), preventing
an invalid fixture from falsely proving isolation. The original three cases
still pass upstream. TestFXStateDoesNotWait now asserts cached/stale rate plus
zero requests in intranet, while retaining asynchronous refresh upstream.

Verified at this step: production,packedassets,intranet GUI run covering the
new isolation test, FX behavior and TestProviderSaveModelPrefs passes (4.536s);
upstream GUI run covering all three original Codex group cases and FX behavior
passes (6.107s). No product code changed. The previous package timeout occurred
when the 240s package budget elapsed with TestProviderSaveModelPrefs only 1s
into its execution; its isolated pass is evidence against calling that test
itself a reproduced hang. Remaining suite/profile/lifecycle issues stay open.

At 6f4528fbd, regenerated actual intranet packed assets and ran:
`go test -tags production,packedassets,intranet ./internal/gui ./internal/distribution ./internal/appdir -run 'TestIntranet|TestWorkspace|TestAsset|TestCoreScriptBudget|TestInternalConfig|TestFX|TestAgentConnectAPI|TestProviderSaveModelPrefs' -count=1 -timeout 120s`.
All three packages passed (GUI 7.951s, distribution 0.121s, appdir 0.967s).
Matching gateway/GUI workspace, isolation, FX and native connect/model-prefs
tests passed under -race (gateway 2.691s, GUI 9.279s). Logs are local
workspace-focused-6f4528.log and workspace-race-6f4528.log. This is a relevant
packed/profile/race pass; it does not erase the remaining full-suite failures
or close tasks 1.4/5.5. No application binary change in this test-only step.

### Retained native operation regression

Existing routing-groups-page, Sessions export/search and Settings shortcut
regressions now accept explicit intranet boot and extracted packed assets.
The combined 60-case run passed all routing navigation/editor refresh and
Sessions export/search cases. Chrome's two Settings cases initially asserted
departure before asynchronous intranet navigation completed; waiting for the
Providers view makes the intended state observable. The rerun passed all four
Settings shortcut cases in Chrome/WebKit and English/Chinese. Session search
also covers all five languages, narrow layouts, query replacement and partial
results; export covers native/web behavior. Full run log is local
workspace-retained-4919.log and retains the initial failures transparently.

workspace-groups-acceptance.cjs passed both engines against packed assets:
prefilled native editor creates a group, API receives its actual member,
refused edit retains draft, retry updates the name, switch off/on and confirmed
deletion complete through native controls. Its API fixture is isolated and
does not claim real backend persistence; actual group persistence/request was
verified separately in workspace-runtime.cjs. Tasks 1.4/5.5 remain open pending
the remaining retained-operation coverage and broader acceptance audit.

### Latest merged build delivery 062343

Re-fetched fork/main at 0372636b4 and verified it is already an ancestor of
feature/intranet-routing-workspace. Built clean detached source f15ef0851,
manifest workingTreeChanges false, excluding user-local .github tooling.
Version 0.6.0 Windows x64 ZIP: 73,276,051 bytes; SHA256:
29854da541877242fb61f4335efa8cac91b731720ee5a538114f391ae887a1ab.
The actual isolated Windows program passed all ten retained-page checks with
no script errors, seven loopback streamed replies, attributed 180-point
throughput, routing-group persistence/request and TIG preset checks.
All 54 local manifest files and the core-script budget passed. Playwright
captures (synthetic data only) returned HTTP 200 at:
http://124.220.199.224:8805/workspace-review-20261116/delivery-062343/delivery-062343.html
Delivered local -> laptop -> personal iDisk -> KF. Both remote ZIP hashes
match the local archive. KF independently verified all 54 extracted files
and source commit f15ef0851233dae2fd013e6e61bc27367620742e.
Laptop ZIP: C:\Users\eddiewang\Downloads\sub2agent-windows-x64-20261116-062343.zip
KF executable:
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-062343\sub2agent-windows-x64-20261116-062343\sub2agent.exe
Previous packages were retained; KF application was not auto-started.
This delivery does not close the separately recorded full-suite failures
or the remaining broader workspace acceptance tasks.

### Retained Gateway, Usage and internal Settings operations

The native gateway-caller-keys suite now accepts the same opt-in
MAGPIE_ASSETS/MAGPIE_INTRANET_TEST profile used by retained Sessions tests.
Internal settings navigation uses the flat page; upstream retains its network
tab. LAN rows are selected by their synthetic identity rather than branding.
All four Chromium/WebKit x en/zh cases passed against production-packed
intranet assets, and the same four passed against default upstream assets.
They cover key create/copy/disable/enable/rename, usage key filtering/export,
LAN enable/copy/rotation cancel+confirm/recreation, confirmed removal and
560px overflow. Fixtures use fake credentials only; none were published.
New build/workspace-settings-acceptance.cjs passed Chromium and WebKit:
invalid port never posts, failed save retains its editable draft, retry saves,
lightweight writes preserve an unrelated preference, and returning from
Sessions rereads the saved port. Backend settings persistence is synthetic
in this test; real packaged runtime checks remain separately recorded above.
Node syntax checks passed for all three changed scripts. This step changes
only test infrastructure and evidence; the KF-delivered f15ef0851 application
remains the current product binary. Remaining broad acceptance gates stay open.

### Packaged isolation and combined regression at 4fe27ae9c

The current 062343 package was restarted as isolated PID 29896 after creating
synthetic original-Magpie settings/auth sentinels under its QA XDG root.
build/workspace-runtime-isolation.cjs passed against that actual process:
the API data path resolves to XDG_CONFIG_HOME/sub2agent; a lightweight preference
is written to disk, reread after reload and restored; the 19893 port is retained;
both original-Magpie sentinel files remain byte-identical and their fake auth
marker does not appear in provider data. The test never accesses live user files.
The first draft incorrectly treated the API's home-abbreviated path as absolute;
it now expands the display-only tilde against the known QA home. Another draft
ran before lazy settings initialization; it now opens Settings and waits for
prefs before writing. Neither draft changed application code.

Fresh production/packed/intranet related Go checks passed for GUI, gateway,
distribution and appdir, including SharedConfig/InterruptedConfig migration.
Gateway and GUI workspace/connect/model preference/FX/isolation race checks
passed (2.413s/9.812s). Full assetpack/appdir/distribution packages passed upstream.
Windows and Linux related go vet passed; Windows upstream and Linux intranet
nogui production builds passed. Existing full-suite red results remain recorded.

The eight-script combined packed GUI run passed both engines: workspace main
acceptance, native provider operations, focus, hidden-model bulk recovery,
Agent diagnostics, lifecycle, native group operations and internal Settings.
Re-ran actual packaged runtime ten-page/streamed-output checks successfully.
Added three actual-runtime expanded throughput captures before the uncalibrated
group-model request; the provider capture visibly shows 480.0 token/s. Viewed
locally and published all three dimensions alongside the ten retained pages at:
http://124.220.199.224:8805/workspace-review-20261116/delivery-062343/delivery-062343.html
Published provider PNG returned HTTP 200. No QA home, logs or auth key uploaded.

Tasks 1.4/5.5 remain open: disconnect-preview still has a known hard-coded
upstream title assertion, and final requirement/evidence audit is not yet complete.
This test/docs step does not replace the delivered product binary.

### Native disconnect preview acceptance

The retained disconnect-preview test now supports explicit intranet packed
assets and checks this fork's Sub2Agent title. Its write audit excludes only
the existing update liveness and native titlebar negotiation endpoints, not
Agent/settings writes. Both browser engines and English/Chinese passed all
three viewport/zoom cases with omp and Codex: full-width file diff and note,
visible heading/buttons, expansion, scroll to restored value, cancellation
and zero configuration writes. The original title/startup-POST failures were
test-profile assumptions; no application behavior was changed in this step.

### Availability requirement audit correction

The workspace-agent-routing spec requires unavailable groups to be disabled
and explained. Audit found no explanation and a disabled-group edge: groupsJSON
can report ready members even when the group's disabled flag is set. The
workspace now disables shortcuts on either condition and adds visible native
note text (plus the button title) for disabled/no-available-members, translated
in all five languages. The backend save guard remains unchanged.

Regenerated production intranet assets. New workspace-group-availability.cjs
passed both engines across five languages at 390px: both explanations, the
ready=true/disabled=true case, no Agent writes and no horizontal overflow.
The main acceptance run passed both engines for routing unavailability and
all prior workspace flows; the dedicated test proves the final disabled-ready
predicate. Related packed GUI workspace/omission/core budget tests passed
(2.311s), Node syntax and diff whitespace checks passed. Updated owning routing
reference. Product change requires a refreshed review build; KF still has the
previous f15ef0851 binary until a new delivery is recorded.

### Verified refreshed package 070219

Built clean source bfc068858 after the availability correction. Version 0.6.0
Windows x64 archive is 73,276,622 bytes; SHA256:
98c532448e43a5dc4477d3fd5a1abd2976bc21310462aa059083ac82fcf7341e.
Actual packaged runtime passed the ten-page/streamed-output verification.
Extended runtime verification disables the real native group through its API,
checks the visible disabled reason and disabled shortcut, captures it, then
reenables the group and waits for an enabled choice. Both writes succeeded.
Restarted the same isolated bundle as PID 27908 with synthetic Magpie sentinels
present before startup; actual directory/write/reload/restore isolation passed.

Final packed page matrix passed 120 cases (two engines x two themes x three
widths x ten pages). Combined native operation suite passed all 68 tests:
Sessions search/export, group navigation/editor refresh, Settings shortcuts,
Gateway key lifecycle/Usage export, and disconnect preview. Log:
D:/git/sub2agent-new/.build-tools/workspace-final-native-bfc068.log.
The real native TestAgentDisconnectAPI also passed (2.016s). These checks plus
the separately recorded model/picker/provider/bulk/lifecycle cases close 1.4.

Published and visually inspected actual disabled-group screenshot, plus ten
pages and three throughput dimensions. Review HTML returned HTTP 200:
http://124.220.199.224:8805/workspace-review-20261116/delivery-070219/delivery-070219.html
No credentials/logs/QA home included. New ZIP delivered laptop -> personal
iDisk -> KF. Both remote hashes match; KF independently verified all 54
manifest files and clean bfc068858 source. KF executable:
C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-070219\sub2agent-windows-x64-20261116-070219\sub2agent.exe
Older packages retained; KF app not automatically started. Product binary is
current; the subsequent commit records verification-only script/doc updates.

5.5 remains open for the final scope/known-red audit. The related packed Go,
race, vet, build and actual isolation checks above passed, but the broader
suite failures recorded earlier must not be silently converted into passes.

### Corrected reproduced known-red test assumptions

Reproduced TestSenderAgainstRealSummaryServer (zero report) and
TestSharedCheckedReadsOnceAndKnowsUnknown (14 shared vs 31 copied allocations).
Root causes were test assumptions, not workspace accounting changes:
- The Go fixture queried a UTC calendar date, but the collector stores/reports
  local days. The integration now deliberately uses 23:30 UTC and runs both UTC
  and Asia/Shanghai child servers, querying the collector's own dayStamp and
  asserting HTTP 200 as well as exactly-once billing/counters.
- Windows environment/file reads add allocation overhead outside the settings
  clone. The no-copy check now directly compares warmed shared slice/map
  identity and requires fewer allocations than LoadChecked, retaining changed
  file and malformed file assertions. Initial cold reads are not warm identity.

Both complete packages pass under intranet (accounting 1.891s, settings 14.341s).
Go overlay mutation checks fail as required: forcing SharedChecked to clone
fails identity/allocation assertions; restoring the UTC query date fails only
the Shanghai cross-midnight case with zero counters. gofmt/diff checks passed.
No application code or billing/aggregation policy changed. Remaining unrelated
profile/Windows broad-suite failures still require explicit tracking.

### Open broad-suite tracking (remote Issues disabled)

Current representative GUI failures were rechecked at a5b15728b:
TestBackupLibraryRoundTrip, TestProviderBilling and TestBootSaysBuiltinsOff
fail because their fixtures expect intentionally omitted intranet modules or
providers. Their output was not marked green. Existing remote issues were
searched/read first (none); attempting to create a concrete issue returned
HTTP 410. Repository API confirms has_issues=false. No remote issue exists and
repository settings were not changed. The issue is instead recorded as Open
in docs/issues/intranet-suite-contracts.md with causes, reproduction, remaining
observer-disposal investigation and closure conditions. This is a committed
in-repository issue, not a claim of remote filing or a waiver of failures.

A separate deterministic Windows cleanup cause was fixed in the test only:
TestGatewayHeldByAContainer hard-linked the running parent executable, which
cannot be unlinked on Windows even after the child exits. It now uses the same
Windows-copy condition already present in gateway_replace/takeover tests.
The corrected test passed (8.909s); mutation/race verification follows below.
No product behavior or delivered executable changed.

Windows cleanup overlay restored the old hard-link path and failed exactly at
TempDir RemoveAll with Access is denied (9.417s), confirming the test fix reaches
the observed cause. Full accounting/settings packages also passed -race under
intranet (4.101s/12.920s). No races were called flaky or suppressed.
