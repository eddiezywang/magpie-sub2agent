# Sub2Agent 内网首页

本目录保存当前 UAT 首页的静态文件。入口为 `/wemail/sub2agent/`；HTML 中使用绝对路径，避免入口末尾没有斜杠时资源加载失败。

Windows 下载按钮直连 `http://172.21.0.177:18989/sub2agent/releases/latest/windows-amd64`，页面显示 Windows 64 位。macOS 读取现有的 `downloads.json`。发布首页时，先上传带新文件名的 JS，再原子替换 `index.html`，并保留旧首页供回滚。

UAT 当前文件位于 wemail Pod 的 `/app/dist/sub2agent/`，Pod 重建后可能丢失。部署后从 KF 检查有无末尾斜杠两种入口、资源类型、页面渲染以及各平台下载链接；目前不设置自动恢复。

用户群二维码是单独发布的活动资源。发布前确认企业微信二维码有效期，将裁图保持原始黑白和白边，
分别上传带日期的新 PNG 与样式，再切换首页引用。二维码图片随活动更新，代码库记录布局与资源引用。
