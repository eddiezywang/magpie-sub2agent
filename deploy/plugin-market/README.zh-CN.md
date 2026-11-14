# 内网插件广场

部署到指定的内网服务器。使用独立 systemd 服务和 Python 3.11
标准库，提供只读目录、npm 兼容版本元数据和完整 ZIP 包；不需要联网安装依赖。
这不是公网 npm 的透明代理。

当前发布集合包含 WorkBuddy 企业、TIG Coding Plan、CodeBuddy、Trae、Notify，及 12 个已迁出的 Magpie 社区供应商。新增的社区供应商随应用内置且默认禁用，广场也提供安装与更新。model-map 默认内置。
默认 Python 太旧时设置 `PYTHON_BIN=/opt/python311/bin/python3.11`。

## 部署

本机通过 `hc` 到 Windows `kf`，再使用其已有的 `wecli test-jump` 会话：

```text
wecli test-jump open --name sub2agent-market-1113
wecli test-jump exec sub2agent-market-1113 "ssh eddiewang@172.21.0.177"
wecli test-jump exec sub2agent-market-1113 "sudo su - root"
```

先检查现有监听与服务，保留其他业务。将本目录的文件传到该机器的独立临时目录后：

```sh
cd /path/to/plugin-market
bash install.sh
python3 /opt/sub2agent-plugin-market/bin/check.py --base http://127.0.0.1
systemctl status sub2agent-plugin-market --no-pager
```

安装脚本固定写入 `/opt/sub2agent-plugin-market` 与专用 systemd unit。
首次部署遇到 80 端口被占用会退出，请将现有反向代理的
`/magpie/plugins/`、`/npm/`、`/healthz` 路径接入专用服务后再调整监听配置，
不要覆盖已有站点。已有目录不会被清空，已有 registry 不会被空目录覆盖。
初始目录为空是正常状态，客户端会显示“连接正常，管理员尚未发布插件”。

如果使用 firewalld，应按组织内网网段放行 TCP 80；脚本不修改防火墙规则。
在另一台能访问内网的主机运行 `check.py`，才能验证跨主机连通，不能只看本机 curl。

## 发布

当前 v1 协议接收已将运行时依赖打入 `index.js` 的 ESM 包。`package.json`
需包含准确的 `name`、`type: "module"`、`main: "index.js"`；不得包含
dependencies、optionalDependencies、peerDependencies 或 scripts。
仅发布 `package.json`、`index.js` 和可选的 `README.md`，不扫描或上传其他文件。
多文件、原生模块和需要外部依赖的插件暂时用本地完整文件夹导入。

```sh
python3 /opt/sub2agent-plugin-market/bin/publish.py \
  --root /opt/sub2agent-plugin-market/www \
  --plugin /path/to/reviewed-bundle --version 1.0.0 --summary '插件的用途'
python3 /opt/sub2agent-plugin-market/bin/check.py
```

发布器生成带 SHA-256 名称的不可变 ZIP、版本元数据，最后原子替换目录。
同一个版本不可换内容；发布新版本号。并发发布会被锁拒绝。
发布前的目录保存在 `registry.previous.json`。服务没有上传接口，只接受管理员
在服务器上通过 CLI 发布的已审核代码。

客户端仅下载内网制品，先核对字节数和 SHA-256，解压到暂存目录，再检查包名、
版本、入口和依赖约束，最后替换已安装目录。ZIP 只接受上述三个普通文件，
拒绝路径穿越和链接，不执行安装脚本，不运行 `bun install`。下载或校验失败保留旧版。

## 错误与回滚

- 超时：检查用户内网/VPN、到 `172.21.0.177:80` 的路由及防火墙，客户端可重新连接。
- 拒绝连接：检查 `systemctl status sub2agent-plugin-market` 和端口监听。
- HTTP 404：检查 `www/magpie/plugins/registry.json` 是否部署。
- HTTP 5xx / 格式错误：查看 `journalctl -u sub2agent-plugin-market -n 100`。
- 目录无法读取：客户端保留上次有效缓存；已安装插件和离线导入仍可用，不回退公网。

回滚目录时先备份当前 `registry.json`，将已验证的旧目录通过同目录临时文件
原子替换回来，并将对应 `npm/<包名>/latest` 恢复成同版本元数据；制品文件不删除。
客户端点击“重新连接”后可安装旧目录指定的版本。
停用服务使用 `systemctl disable --now sub2agent-plugin-market`，保留文件以便恢复。

验证：`python3 -m unittest discover -s deploy/plugin-market -p test_market.py`；
Go `TestIntranetBundleInstallsAndPreservesPreviousOnFailure` 覆盖安装、摘要不匹配、
版本不匹配和不完整/不安全归档。真实账户登录与第三方插件运行需各插件单独验证。

## 首批发布与更新

四套内部供应商为 `@sub2agent/codebuddy`、`@sub2agent/workbuddy`、
`@sub2agent/trae`、`@sub2agent/aiep`，均随应用内置，可断网启动。
广场安装的有效版本优先于随包版本，升级应用不会覆盖广场版本；下载或校验
失败保留旧安装。既有账号、Key、配置、关闭状态均保留，不生成重复供应商。
AIEP 保留原生 Key 配置与 Bearer 鉴权，插件管理其版本化默认配置。

Model map 是默认启用的内置模块，不需要从广场安装。
`@magpie-community/gateway-notify` 是可选广场插件，保留上游通知页面与钩子，
不随应用安装；通知渠道默认空、正文默认不发送，需填写内部通知地址。
社区插件不代表供应商官方认证。其源码固定到审核提交，许可证随包保留。

### 构建机准备三个完整包

```powershell
node build/sub2agent-providers.mjs ..\sub2agent
python build/prepare-plugin-market.py --community <community-plugins源码目录> --output <私有发布目录>
```

社区源码必须固定在 `e90d6f011a7320372c5570600e9b267f75b34714`。
准备工具生成 `www`（已生成目录与制品）、`staging`（三套发布源）、`service`
（部署工具）和来源记录。该目录含内部供应商实现，须经已授权的内网通道传输，
不得放到公开截图站、公开仓库或包含任何客户端 data/账户/Key。

通过 kf 中转进入服务器后，先核查端口与已有业务；以 root 身份执行：

```sh
cd <解压后的私有发布目录>/service
bash deploy-release.sh
```

部署器拒绝占用现有非本服务的 80 端口；已有反向代理时应先配置转发。
发布器依次写入制品和元数据，最后原子替换目录，保留其他已发布插件及上次目录；
同一版本不允许覆盖修改，更新请提升语义版本。不会覆盖客户端安装或认证数据。
多文件离线包使用格式 2，声明精确文件清单与页面/钩子入口；禁止路径越界、
链接、Windows 设备名、重复路径、安装脚本与外部依赖。单文件旧包继续支持。

从实际客户端网络再运行 `check.py --base http://172.21.0.177`，并在隔离客户端
验证发现、安装、升级、离线保留与通知配置。真实企业登录和推理需可用企业账号验证。
广场仅分发插件，供应商登录、额度查询和推理仍访问对应企业服务。

### 经 laptop 和云盘转运

部署包先上传外部中转服务器的私有目录。需要 HTTP 下载时，仅公开临时加密包，
解密密钥通过已连接的 `hc` 会话单独传入 laptop，不写入下载页或公开日志。
laptop 在 `hc machine ls` 中的当前名称是 `labtop`，kf 名称是 `kf`。

1. laptop 下载、解密并核对部署归档 SHA-256，再执行
   `wecli idisk upload <归档> --space self -f json`。
2. kf 使用同一账号执行
   `wecli idisk download <云盘路径> <本地归档> --space self -f json`，核对同一摘要。
   老版本没有 idisk 时，可通过内部 npm 仓库临时调用已验证的版本：
   `npm exec --yes --registry=http://wnpm.weoa.com:8001 --package=@webank/wecli@1.14.0 -- wecli idisk ...`。
3. 先读取 `wecli test-jump` 命名会话当前主机，确保已通过
   `ssh -p 36000 eddiewang@172.21.0.177` 登录目标；不要把跳板机当成部署目标。
   用 `wecli test-jump upload <会话> <归档> --remote-dir /tmp` 上传。
4. 在目标上再次核对 SHA-256，通过 `sudo -n` 备份专用服务目录和 unit；解压到
   `/opt/sub2agent-plugin-market/releases/<发布标识>`，指定 Python 3.11 执行部署。
5. 检查服务 enabled/active、本机 healthz 和 check.py，再从 kf 验证目录、npm
   元数据及每个实际下载包的字节数与 SHA-256。完成后移除公网临时加密包。

发布到服务器时，以目标 Python 3.11 发布器实际生成的制品摘要为准。不同 Python/
zlib 构建环境的 ZIP 压缩结果可能不同；不要直接把构建机的 www 覆盖到生产目录，
也不要绕过同版本不可变检查。本次在目标重打包得到与既有版本完全相同的摘要。

### 部署状态（2026-11-14）

已按“中转服务器 → laptop → idisk → kf → test-jump → 目标机”完成部署和跨主机验证。
`sub2agent-plugin-market.service` 已启用并运行，监听 TCP 80，healthz 返回 3 个插件。
当前发布 WorkBuddy 企业 1.0.4、TIG Coding Plan 1.0.4、Notify 0.1.4；同版本制品
摘要保持不变。此次未发布尚在研究的 MaaS gzip/容量调整。

本次发布源位于 `releases/20261114-relay/market-release-20261114`；部署前目录备份
为 `backups/before-relay-20261114.tgz`，unit 备份在同目录。真实账号登录和长上下文
推理不属于静态广场可用性检查。

### 社区供应商发布（2026-11-14）

发布 CodeBuddy、Trae 和 12 个已迁出的社区供应商后，插件广场共 17 个条目。
制品来自固定社区提交 `e90d6f011a7320372c5570600e9b267f75b34714`，
目标机和客户端网络均核验了目录及全部制品的 SHA-256；发布前目录备份为
`/opt/sub2agent-plugin-market/backups/before-community-providers-20261114.tgz`。
社区供应商的真实账号登录和推理尚未验证。原生 API 预设与仍在核心中的订阅
尚未转成内置插件。
