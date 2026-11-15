# 工作台交付验收核对

核对日期：2026-11-16。交付分支：`feature/intranet-routing-workspace`。
实际程序：干净的 `bfc068858`，版本 0.6.0，Windows x64 完整包 `070219`。
此后修改均为测试、测试脚本和文档，未改变交付应用行为。
详细命令、失败过程和阶段结果保留在 [verification.md](verification.md)。

## 方案任务与证据

| 任务 | 已核对的实现及验证证据 |
| --- | --- |
| 1.1 | workspace.js 的唯一原生 Agent/Providers/Routing 宿主；GUI 子系统文档说明挂载依赖。 |
| 1.2 | 移动原 DOM，保留原 render/API/全局弹层；实际包十页及双引擎 native-host 检查。 |
| 1.3 | workspace-focus、workspace-lifecycle：草稿、焦点、迟到刷新、六次进出观察器释放。 |
| 1.4 | 68 项组合原生测试；Agent/模型/供应商/组专门测试；核心脚本预算通过。 |
| 2.1 | 内网打包入口、默认/历史/深链测试；独立十页可达，Sessions 保留。 |
| 2.2 | 默认折叠、真实计数、未知及失败重试；批量与状态测试。 |
| 2.3 | 原生供应商增删改、探测、启停、拒绝保存重试及合成认证；TIG/CIB 图标/名称检查。 |
| 2.4 | 复用 routing 插件；米白点阵与原生容器；120 组页面主题/尺寸检查及截图。 |
| 2.5 | workspace-providers 的独立页同步；实际配置 API 保存和重载。 |
| 2.6 | workspace-agent-status：原生漂移详情保留、重复 connection-check/adapt 行移除。 |
| 2.7 | Agent 内容区工具栏、完整候选快照、数量、排除未安装 CLI、原生共享锁。 |
| 2.8 | 主验收及 hidden-model 专测覆盖失败继续/失败重试、取消跳过、离页停止、模型保留。 |
| 3.1 | 明确目标与真实主模型；无可操作 Agent 时提示且不写配置。 |
| 3.2 | 正式 templateKind 数据；手工组不冒充模板；空组/不可用/停用组行为验证。 |
| 3.3 | setPick 复用；组删除服务端拒绝、晚响应/切目标/刷新保护及 pending 锁。 |
| 3.4 | 原生 Groups 跳转返回、增改启停删除；实际包重载和组请求成功，其他 Agent 主模型不变。 |
| 4.1 | live 内容增量入口采集；TestWorkspaceThroughputReceivesDeliveredContent 及实际 SSE 回复。 |
| 4.2 | 秒桶/平滑/峰值/epoch：窗口边界、重启与独立序列测试。 |
| 4.3 | 固定换算/未知 null：UnknownAndLimits、WindowAndAttribution；客户端待校准显示。 |
| 4.4 | 128/512/256 上限、截断及独立总量；受控时钟和并发测试。 |
| 4.5 | GUI/owner 接口；OwnerAndUnavailable、RejectsUnsupportedOwner；实际 Web 读取网关。 |
| 4.6 | gateway/gui 相关 -race 检查通过；窗口、归属、重试、无会话、同名、重建测试。 |
| 4.7 | OwnerBoundary、HeldKeysCannotReadOtherSessions；KeepsSessionsSpeedsContract；响应类型不含内容/凭据。 |
| 5.1 | 实际包正数、峰值及三维展开截图；180 点；窄屏图表及数字检查。 |
| 5.2 | 单飞、后台/离页中止、未知、断线保留、epoch 替换：主 GUI 验收。 |
| 5.3 | 实际程序本机 SSE 输出、维度归属、组路由、重载；发行包没有预览 fixtures/iframe 引用。 |
| 5.4 | 两引擎 x 两主题 x 三宽度 x 十页，共 120 组；键盘折叠和维度切换。 |
| 5.5 | 实际打包、预算/语法/相关 Go 与 race、双系统 vet、上下游构建、实际隔离、上游接口缺席与原样 index，详见下节。 |
| 5.6 | GUI、路由、会话统计、内网构建文档已包含接口/上限/状态/回滚，链接源码。 |
| 5.7 | 14 张合成数据截图发布；审查首页及每张图片均 HTTP 200；提交推送和交付摘要留档。 |

## 5.5 的验证范围和结果

- production/packedassets/intranet 的 GUI、gateway、distribution、appdir 相关测试通过；workspace/connect/model/FX/isolation race 检查通过。
- accounting 与 settings 两个完整包及 -race 通过。实际 Node collector 在 UTC/上海两时区验证跨午夜汇总和重复投递不重复计费；没有修改分钟计费策略。
- 共享设置的热读保留同一 slice/map，并少于复制读取的分配次数；文件变化和无法解析仍正确处理。强制复制的反向检查失败。
- Windows gateway 容器夹具使用复制，已通过；恢复父程序硬链接的反向检查稳定复现 Access denied 清理失败。
- Node 语法、diff whitespace、核心脚本预算通过；Windows 和 Linux 相关 go vet、Windows upstream/Linux intranet nogui production 构建通过。
- 上游 GUI 和 gateway 不注册工作台吞吐量接口；对应测试在两种 profile 均通过。无 intranet 标签的 assetpack 输出 index 与原文件逐字节相同，不加载工作台脚本或样式。默认发行及托盘入口不被工作台替换。
- 实际 070219 包在独立 HOME/APPDATA/XDG 中启动。Settings 报告目录与 XDG/sub2agent 相符，设置落盘/重载/恢复成功，启动前放置的原版 Magpie 设置及认证哨兵逐字节未改动。
- 包 manifest 声明工作区干净；54 个文件经 KF 独立校验。用户原有 .github 工具目录未打包、未提交。

这里关闭的是工作台方案要求的相关验证，不声明全仓所有历史测试通过。全仓 intranet GUI 仍有上游专用夹具与被移除功能的冲突，以及待调查的测试 observer 生命周期问题；已在 [待解决问题](../../../docs/issues/intranet-suite-contracts.md) 保留为 Open。GitHub Issues 被仓库关闭，创建返回 410，没有声称已创建远程 Issue。

## 交付物与边界

- 本地运行：`sub2agent-windows-x64-20261116-070219/sub2agent.exe`，隔离 QA web 19894 / gateway 19893，PID 27908（进程存活已核对）。管理密钥只保存在本机 QA 文件，未发布。
- ZIP SHA-256：`98c532448e43a5dc4477d3fd5a1abd2976bc21310462aa059083ac82fcf7341e`。本机、laptop、KF 一致。
- KF：`C:\Users\eddiewang\Downloads\sub2agent-workspace-20261116-070219\sub2agent-windows-x64-20261116-070219\sub2agent.exe`。旧包保留，未自动启动 KF 程序。
- 审查入口：http://124.220.199.224:8805/workspace-review-20261116/ 。含十个保留页面、三个吞吐量维度、已停用组状态；无日志、认证回调、密钥或 QA 数据目录。
- 吞吐量为估算输出 token/s，未知保持待校准；只保留内存窗口。原生 API 的真实请求已用本机合成上游验证；没有使用真实企业账号进行供应商生产认证或计费实测。
- 交付状态为“实现并验证，等待用户审查”；不代表用户已接受视觉，也不代表原有全仓问题均已修复。
