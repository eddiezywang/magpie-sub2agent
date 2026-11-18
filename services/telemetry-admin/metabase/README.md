# Sub2Agent 用户用量分析

腾讯云的 8897 由 Nginx 终止 TLS，根路径提供 Metabase 开源版，匿名汇总保留在 /overview/。
访问端和 0.177 使用独立的 Sub2Agent Analytics CA 校验 TLS，私钥保留在云主机。

0.177 每五分钟读取最近 90 天已落盘的数据，以北京时间为日期。分钟包按安装和包 ID 去重。
用户名来自客户端操作系统，原始安装 ID 经过带密钥的散列。用量按日期、用户名、安装、
Agent、供应商和模型汇总。版本为当天或之前最后上报的版本，同日升级前后的用量无法分摊。
活跃记录独立于用量记录。新的完整快照在 PostgreSQL 事务中替换旧数据。

## 服务

- Docker 网络 sub2agent-bi 内运行 PostgreSQL 15 和 Metabase v0.64.1。应用库 metabase_app
  与分析库 sub2agent_analytics 分开，分析库有独立写入和只读角色。
- 以 analytics_writer 在分析库执行 schema.sql。将分析库通过 analytics_reader 加入
  Metabase 后，运行 python3 provision.py /etc/sub2agent-metabase 建立仪表盘。
- sub2agent-bi-receiver.service 使用 psycopg2 2.9.11，连接串通过 systemd credential 注入。
  接收器和 Metabase 分别监听回环 18898 和 18897。Nginx 在 8897 转发浏览器和同步请求。
- 0.177 安装 named.py、同步 service 和 timer。已有环境提供 SYNC_TOKEN 和 https_proxy，
  实名配置提供 BI_SYNC_URL 和 BI_CA_FILE。匿名同步迁到同一 TLS 入口的 /api/snapshot。
- 如需回滚，停用 sub2agent-bi-edge 和 0.177 的实名 timer，恢复匿名服务及匿名同步的
  config.before-metabase 后重启。保留 PostgreSQL 数据卷。
