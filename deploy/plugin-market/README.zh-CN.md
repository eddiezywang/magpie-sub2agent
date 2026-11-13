# 内网插件广场

固定地址：`http://172.21.0.177`。使用独立 systemd 服务和 Python 3.11
标准库，提供只读目录、npm 兼容版本元数据和完整 ZIP 包；不需要联网安装依赖。
这不是公网 npm 的透明代理。

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

### 构建机准备五个完整包

```powershell
node build/sub2agent-providers.mjs ..\sub2agent
python build/prepare-plugin-market.py --community <community-plugins源码目录> --output <私有发布目录>
```

社区源码必须固定在 `e90d6f011a7320372c5570600e9b267f75b34714`。
准备工具生成 `www`（已生成目录与制品）、`staging`（五套发布源）、`service`
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

### 部署状态

当前 kf SSH 中转不可达，服务器尚未完成安装验证。发布包和本地验证完成不等于
服务已上线。链路恢复后先重新检查端口与服务，再部署并跨主机验证。
