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

## 首批目录建议（2026-11-13）

建议先发布内部维护的 `@sub2agent/codebuddy`、`@sub2agent/workbuddy`、
`@sub2agent/trae` 三个完整包，作为分发及版本归档；现有应用已经随包加载它们，
不要在同一个客户端再安装第二份。现阶段发布到广场不会自动将客户端随包插件迁移
成市场管理的插件，统一更新入口需要另行实现和验证。

行内 AIEP Coding Plan 是原生 API-key 供应商；Claude、Codex 也已有入口，
均不需要为了广场再包装一份认证插件。埋点上报和会话是已保留的内置模块，
不需要下载。不要恢复已删除的资源库、脱敏、联网搜索等模块。

外部候选只按实际账户需求引入：有 GitHub Copilot Business/Enterprise 使用场景
时再评估 `@magpie-community/opencode-copilot-auth`；有 Qoder、Kiro 等实际
账户时再单独审核对应插件。不默认安装全部认证插件。
Magpie community 仓库自己标明由社区维护，不等于供应商官方认证：
<https://github.com/magpie-community/plugins>。Copilot 插件说明也明确标为
unofficial：<https://github.com/magpie-community/plugins/tree/main/packages/copilot>。
社区 Trae 插件的企业模式仍有未验证范围，不能直接替换本项目的私有认证逻辑：
<https://github.com/magpie-community/plugins/tree/main/packages/trae>。

### 构建机准备内部制品

从受控构建环境生成完整运行包（不把私有实现提交到公开仓库）：

```powershell
node build/sub2agent-providers.mjs ..\sub2agent
```

输出为 `build/sub2agent-runtime/{codebuddy,workbuddy,trae}`，包入口为
`index.js`，无依赖声明或安装脚本。将这三个目录通过已授权的内网通道传到
服务器专用暂存目录，例如 `/opt/sub2agent-plugin-market/staging/`。
不要打包 portable 的 data 目录、账户文件或密钥。发布器会为包写入指定版本。

服务器首次发布示例（`1.0.0` 是示例首版号，实际按内部版本管理分配）：

```sh
for name in codebuddy workbuddy trae; do
  python3 /opt/sub2agent-plugin-market/bin/publish.py \
    --root /opt/sub2agent-plugin-market/www \
    --plugin "/opt/sub2agent-plugin-market/staging/$name" \
    --version 1.0.0 --summary "Sub2Agent 内部维护的 $name 认证适配"
done
python3 /opt/sub2agent-plugin-market/bin/check.py --base http://127.0.0.1
```

还应从实际客户端所在网络运行 `check.py`，并在隔离客户端验证安装、登录、
回调、刷新令牌和一次真实推理。包的本地测试通过不代表真实企业账户已验证。
当前测试套件可验证目录服务、元数据和制品，但没有真实企业账户可代测登录。

### 部署边界与状态

广场服务器只分发审核后的代码和版本元数据；登录、本地回调和凭据保存仍由
各客户端负责。将包放入内网，不会把第三方 OAuth、额度查询和推理变成离线服务，
这些请求仍需到相应供应商或企业服务。

截至本次复查，`hc exec --on kf` 仍报告 kf 的 SSH 中转连接关闭；
因此服务仍是“部署包已准备，服务器尚未完成安装验证”。恢复链路后先重新检查
端口和现有服务，再执行上面的部署及跨主机检查，不直接覆盖其他业务。
