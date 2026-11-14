# Sub2Agent 内网应用版本

应用只读取 `http://172.21.0.177/sub2agent/releases/latest.json`，且必须通过客户端内置 Ed25519 公钥验证签名和文件 SHA-256。签名私钥保存在管理员工作站，不放到服务器或代码库。安装包只发布单文件版本，以便已有配置和插件数据不被覆盖。

管理员先构建、验证并准备版本：

```powershell
.\build\intranet.ps1 -SingleFile -Version <版本号>
node build/intranet-release/prepare.mjs <新构建的sub2agent.exe> <版本号> <管理员私钥路径> <本地发布目录>
```

将发布目录通过授权内网通道传至 0.177。将版本目录完整复制到 `/opt/sub2agent-plugin-market/www/sub2agent/releases/<版本号>`，确认 SHA-256 后，再使用同目录临时文件和 `rename` 原子替换 `latest.json`。版本目录不得覆盖已有内容；新内容使用新版本号。服务仅提供静态下载，无应用端上传接口。发布前备份 `latest.json`，保留旧版本以便回滚。

客户端启动后和定时检查时读取目录，自动下载并验证；通常在用户重启时安装。旧版内网客户端没有更新通道，需要先手动安装一次支持该功能的版本。签名私钥若遗失，需要重新分发包含新公钥的客户端；需妥善备份。
