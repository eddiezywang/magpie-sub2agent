# Sub2Agent 内网应用版本

新版客户端按域名 `http://uat.rcrai.weoa.com/wemail/sub2agent/releases/`、内网 `http://172.21.0.177:18989/sub2agent/releases/`、独立服务器 `http://124.220.199.224:8899/sub2agent/releases/` 的顺序访问。版本检查比较所有可访问且签名有效的版本，选择最新版本，版本相同时优先选择前面的源；安装包也按此顺序回退。任一源可用即可更新。所有文件必须通过内置 Ed25519 公钥和 SHA-256 校验。已发布的旧客户端仍只使用 0.177。签名私钥保存在管理员工作站，不放到服务器或代码库。

## 发布说明

每次发版都在 `build/intranet-release/notes/<版本号>.md` 提交一份 UTF-8 Markdown changelog。以当前线上版本为基线，概述本版用户可见的新增、修复和必要的升级说明。准备脚本会把 Markdown 写入 `latest.json` 的 `notes` 字段，客户端检查更新时从该字段读取说明。

上传前确认清单中的版本和说明对应。云端发布后，等 0.177 自动拉取，再回读更新源的 `latest.json`，核对版本和完整的 `notes`。如需更正已经发布的说明，按新的版本号准备和发布。

管理员先构建、验包，再生成带发布说明的清单：

```powershell
.\build\intranet.ps1 -SingleFile -Version <版本号>
node build/intranet-release/prepare.mjs <新构建的sub2agent.exe> <版本号> <管理员私钥路径> <本地发布目录> <changelog.md>
.\deploy\app-release-mirror\publish-cloud.ps1 -ReleaseDir <本地发布目录>
```

macOS 桌面版可在装有 Xcode 命令行工具的 Mac 或 GitHub Actions macOS
runner 上构建。需准备私有 Sub2Agent 源码及其 npm 依赖、固定版本的社区插件
源码以及账单签名密钥文件。默认使用不需要 Apple 开发者账号的临时签名，适合
内部测试：

```sh
export BILLING_KEY_FILE='<管理员密钥文件绝对路径>'
export SUB2AGENT_SOURCE='<私有 Sub2Agent 源码目录>'
export MAGPIE_COMMUNITY_SOURCE='<固定版本的社区插件源码目录>'
bash build/intranet-macos.sh 0.1.3913-sub2agent.6
```

脚本默认生成 `magpie-darwin-arm64.zip` 和 `magpie-darwin-amd64.zip`，分别适用
Apple 芯片和 Intel；设置 `MACOS_ARCH=arm64` 或 `amd64` 可只构建一种架构。
传入完整发布版本号，应用保留该版本号，macOS bundle 元数据使用前三段数字。
临时签名包未经过 Apple 公证，首次打开可能需要在系统设置的“隐私与安全性”中
选择“仍要打开”，受企业设备策略限制时可能无法打开。它不能证明开发者身份。
如有正式证书，可设置 `MACOS_SIGN_MODE=developer-id`、`MACOS_SIGN_IDENTITY`
和 `MACOS_NOTARY_PROFILE`，执行 Developer ID 签名、公证及装订。

GitHub Actions 手动工作流模板 `build/intranet-release/sub2agent-macos.workflow.yml`
分别使用 Apple 芯片和 Intel runner。将其复制到私有构建仓库的
`.github/workflows/sub2agent-macos.yml` 才能启用；推送工作流文件的 GitHub
凭据需要 `workflow` 权限。**必须在私有构建仓库运行**：公开仓库工作流会拒绝
构建，因为产物包含私有供应商代码且可提取账单密钥。将本仓库的代码同步到私有
构建仓库，并在该仓库设置 Variables `SUB2AGENT_SOURCE_REPOSITORY`（GitHub
私有源码仓库的 owner/name）和 `SUB2AGENT_SOURCE_REF`（建议固定提交哈希），
设置 Secrets `SUB2AGENT_SOURCE_TOKEN`（只读访问该源码仓库）和
`BILLING_SIGNING_KEY`（64 位小写十六进制密钥）。私有源码当前位于其他 Git
服务器，需要先以管理员认可的方式同步到 GitHub 私有仓库。工作流通过手动
触发，分别上传两个保留 7 天的私有构建产物，不会自动发布到更新源；私有仓库
读取者可以下载产物，需控制其访问权限。私有仓库的 runner 使用可能产生费用。

之后把两份 zip 交给发布管理员，
与同版本 Windows 文件一起生成**一份**签名版本清单：

```powershell
node build/intranet-release/prepare.mjs <windows.exe> <版本号> <管理员私钥路径> <本地发布目录> <changelog.md> <mac-arm64.zip> <mac-amd64.zip>
.\deploy\app-release-mirror\publish-cloud.ps1 -ReleaseDir <本地发布目录>
```

以上 macOS 打包流程尚未在 Mac 上验证；发布前必须分别实测安装及原生自动
更新。正式签名的版本需要使用同一个 Apple 团队的签名身份。临时签名不能用于
证明更新者身份；发布清单仍需由管理员使用现有 Ed25519 私钥签名，客户端还会
校验文件摘要。不要在提交历史、日志或公开服务器保存密钥和凭据。

`publish-cloud.ps1` 通过 SSH 上传到腾讯云 `134.175.165.190` 的私有暂存目录。
`pull-release.py` 用 OpenSSL 3 验签并核对所有制品的大小与 SHA-256 后推进云端清单。云端只通过认证的 HTTPS 提供发布物料，配置见 `deploy/app-release-mirror/sub2agent-release-stage.service`。

0.177 上的 `sub2agent-release-pull.timer` 每两分钟启动一次拉取任务。任务使用系统出口代理、本机 netrc 和云服务证书。它先验签，再下载并校验制品的大小和 SHA-256，最后原子替换 `latest.json`。失败会保留当前版本并重试，任务拒绝降级或覆盖内容不同的同版本。如需回滚，先停用定时器并停止运行中的拉取任务，再用保留的旧版签名清单切换。

WeMail UAT 首页的 Windows 按钮直连 0.177 的固定下载地址 `http://172.21.0.177:18989/sub2agent/releases/latest/windows-amd64`。macOS 继续使用首页现有的下载配置。WeMail 域名下的旧更新源仍由 Pod 静态文件提供。已发布客户端可以继续使用 0.177 的清单和版本路径，已从 KF 实测 Windows beta.4 升级到 beta.7。已发布客户端中的公网回退地址 `124.220.199.224:8899` 独立于本次私有暂存源。

用 `systemctl list-timers sub2agent-release-pull.timer` 和 `journalctl -u sub2agent-release-pull.service` 检查拉取状态。从 0.177 验证 `latest.json`、Windows 下载和客户端更新，并从 KF 验证 WeMail 首页的固定下载链接。

客户端启动后和定时检查时读取目录，自动下载并验证；通常在用户重启时安装。旧版内网客户端没有更新通道，需要先手动安装一次支持该功能的版本。签名私钥若遗失，需要重新分发包含新公钥的客户端；需妥善备份。

## 已验证的首个内网版本

2026-11-14 发布 `0.1.3913-sub2agent.3`，应用 SHA-256 为
`b24107c36117ea4dee16abc9bb34be2955c5b96729450809536b80cce6adeefe`。
在另一台内网 Windows 电脑上验证了下载和摘要，并使用隔离目录中的
`0.1.3913-sub2agent.2` 副本执行 `update check` 和 `update`：它发现、下载、
验签并替换为发布版本，替换后摘要一致。该测试没有覆盖实际用户安装、
正在进行的请求或自动重启。已验证的新客户端需先手动安装一次，之后
才能使用内网更新通道。

随后发布 `0.1.3913-sub2agent.4`（SHA-256
`b0e415d194c41f2f9c741d3bf9db13c97ae1dfd53ab3c57fd6465c5ff20aaf13`），
并在同一隔离副本上实测从 `.3` 下载、验签和升级至 `.4`。0.177 保留 `.3`
及其版本目录备份，以便管理员回滚。设置页版本号与检查按钮已在 Chromium
和 WebKit 验证。运行中的真实桌面应用自动重启尚未验证。
