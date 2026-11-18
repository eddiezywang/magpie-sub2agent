# Sub2Agent 埋点管理后台

内网采集服务继续写入 `/var/lib/usage-server`。同步任务在 0.177 本地读取
`telemetry-*.jsonl` 和 `minute-summaries/summaries-*.jsonl`，按北京时间汇总最近
90 天的事件、活跃安装数、网关请求数和 Token。安装标识在内网通过 keyed HMAC 转换为
匿名编号，用于关联版本与分钟汇总。腾讯云接收匿名编号、格式校验后的版本及汇总计数。
版本取所选周期内最后一次上报，不能据此将同一安装跨版本的 Token 分摊给各个版本。
网关请求和 Token 取自 v3 分钟汇总，普通输入、输出、缓存读取和缓存写入分别计数。
已知事件使用固定名称，其余归入「其他事件」。

每次同步发送一份完整快照，接收端根据签名和生成时间验证快照，原子替换已有文件。
同步失败时保留上一次成功快照，页面显示最近同步时间。定时任务在上次执行结束五分钟后触发。

## 部署

腾讯云使用 `sub2agent-telemetry-admin.service`，程序和静态文件放在
`/opt/sub2agent-telemetry-admin`。创建权限为 0600 的
`/etc/sub2agent-telemetry-admin/config` 并设置 `ADMIN_USER`、`ADMIN_PASSWORD`、
`SYNC_TOKEN`、`HOST` 和 `PORT`。快照位于 systemd 管理的状态目录。
公网入口使用 HTTP 8897。HTTP 会以明文传输浏览器登录凭据和展示内容。

0.177 安装 `admin.py` 到 `/opt/sub2agent-telemetry-sync`，安装同步 service
和 timer。其配置 `/etc/sub2agent-telemetry-sync/config` 设置 `SYNC_URL` 和与
腾讯云一致的 `SYNC_TOKEN`。同步地址为 `http://124.220.199.224:8897/api/snapshot`。同步使用 HMAC-SHA256 签名，请求中只携带签名。
服务单位使用 0.177 已安装的 Python 3.11 路径。出站走内网代理时，在同一配置中设置 `http_proxy`。

安装后在 0.177 执行 `systemctl start sub2agent-telemetry-sync`，从腾讯云
回读快照生成时间，确认端到端畅通后检查 timer 和外部访问。
暂停同步使用 `systemctl disable --now sub2agent-telemetry-sync.timer`。
查看失败原因使用 `journalctl -u sub2agent-telemetry-sync`。

本地验证使用 `python -B -m unittest discover -s services/telemetry-admin -v`。
