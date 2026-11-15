# Sub2Agent 内网应用版本

新版客户端按域名 `http://uat.rcrai.weoa.com/wemail/sub2agent/releases/`、内网 `http://172.21.0.177:18989/sub2agent/releases/`、独立服务器 `http://124.220.199.224:8899/sub2agent/releases/` 的顺序访问。版本检查比较所有可访问且签名有效的版本，选择最新版本，版本相同时优先选择前面的源；安装包也按此顺序回退。任一源可用即可更新。所有文件必须通过内置 Ed25519 公钥和 SHA-256 校验。已发布的旧客户端仍只使用 0.177。签名私钥保存在管理员工作站，不放到服务器或代码库。

管理员先构建、验证并准备版本：

```powershell
.\build\intranet.ps1 -SingleFile -Version <版本号>
node build/intranet-release/prepare.mjs <新构建的sub2agent.exe> <版本号> <管理员私钥路径> <本地发布目录>
.\deploy\app-release-mirror\publish-all.ps1 -ReleaseDir <本地发布目录> -JumpSession <KF跳板会话ID>
```

macOS 桌面版需在装有 Xcode 命令行工具的 Mac 上构建，使用 Apple
Developer ID Application 签名身份和 `notarytool` 钥匙串配置；需准备私有
Sub2Agent 源码、固定版本的社区插件源码以及账单签名密钥文件：

```sh
export MACOS_SIGN_IDENTITY='Developer ID Application: <团队>'
export MACOS_NOTARY_PROFILE='<notarytool 钥匙串配置名>'
export BILLING_KEY_FILE='<管理员密钥文件绝对路径>'
export SUB2AGENT_SOURCE='<私有 Sub2Agent 源码目录>'
export MAGPIE_COMMUNITY_SOURCE='<固定版本的社区插件源码目录>'
bash build/intranet-macos.sh 0.6.0
```

脚本生成 `magpie-darwin-arm64.zip` 和 `magpie-darwin-amd64.zip`，分别适用
Apple 芯片和 Intel，执行签名、公证及装订。之后把两份 zip 交给发布管理员，
与同版本 Windows 文件一起生成**一份**签名版本清单：

```powershell
node build/intranet-release/prepare.mjs <windows.exe> <版本号> <管理员私钥路径> <本地发布目录> <mac-arm64.zip> <mac-amd64.zip>
.\deploy\app-release-mirror\publish-all.ps1 -ReleaseDir <本地发布目录> -JumpSession <KF跳板会话ID>
```

以上 macOS 打包和公证流程尚未在 Mac 上验证；发布前必须分别实测安装及
原生自动更新。脚本需要使用同一个 Apple 团队的签名身份，确保已安装版本与
更新包签名者一致。不要在提交历史、日志或公开服务器保存密钥和凭据。

将发布目录通过授权内网通道传至 0.177。将版本目录完整复制到 `/opt/sub2agent-plugin-market/www/sub2agent/releases/<版本号>`，确认 SHA-256 后，再使用同目录临时文件和 `rename` 原子替换 `latest.json`。版本目录不得覆盖已有内容；新内容使用新版本号。服务仅提供静态下载，无应用端上传接口。发布前备份 `latest.json`，保留旧版本以便回滚。

域名源由管理员独立保存并发布相同文件，不应代理到 0.177。先上传版本目录、确认摘要，再更新域名源的 `latest.json`。当前域名源保存在 wemail Pod 的临时静态目录，Pod 重建后副本会丢失，需要重新同步。公网独立副本位于 `124.220.199.224:8899`，其服务实现与部署方式见 `deploy/app-release-mirror`；某些企业网络可能对该公网地址返回拦截页面，因此不保证每台设备都能访问。

一键脚本先在本机验证发布签名、大小和摘要，再依次发布公网副本、通过 KF 和跳板发布 0.177、通过 KF 将 0.177 的已发布文件复制到 wemail Pod。每个目标先校验完整文件再原子更新版本清单，已存在但内容不同的版本会拒绝覆盖。公网主机需要预先配置 SSH；KF 跳板会话必须已连接到可 SSH 到 0.177 的跳板机。中途失败时已成功的源可能已更新，修复后用同一命令重试；旧版本目录保留。KF 与 Pod/0.177 无法直接从公网 8899 获取文件，不应把公网下载当作成功的跨网络验证。

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
