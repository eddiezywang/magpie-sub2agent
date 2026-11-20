# Sub2Agent 用户用量分析

腾讯云的 8897 由 Nginx 终止 TLS，根路径提供 Metabase 开源版。旧版匿名概览和同步均已下线。
访问端和 0.177 使用独立的 Sub2Agent Analytics CA 校验 TLS，私钥保留在云主机。

0.177 每五分钟读取最近 90 天已落盘的数据，以北京时间为日期。分钟包按安装和包 ID 去重，
重复上报保留先处理的一条（内网优先），每行记录来源：内网源数据记「内网」，公网镜像补采的记「公网」。
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
  实名配置提供 BI_SYNC_URL 和 BI_CA_FILE。原同步配置文件仍由 Metabase 同步读取代理和签名密钥。
- 如需恢复历史匿名服务，停用 sub2agent-bi-edge 和 0.177 的实名 timer，恢复匿名服务及匿名同步的
  config.before-metabase 后重启。保留 PostgreSQL 数据卷。

应用日活按北京时间统计当天上报桌面事件的去重用户名，并按当天活跃安装的版本分组；
「新版用户日活」表单独统计 1.0.0 系列及以上，同一用户名的多台安装版本不同时会在多个分组中各计一次。
用户量和日活统计任何埋点事件，用量汇总只统计有网关分钟包的用户，两者口径不同，人数并不相等。
网关在线时长来自客户端上报的时长增量，跨午夜拆分，同一用户名的多台安装累加为设备小时。设备在线时长
和日活使用活动数据源，因此供应商、模型和 Agent 筛选仅作用于网关用量图表。

用户量增长以已导入历史中的用户名首次出现日为准。初始化从现有活动快照回填，
之后每次同步在同一事务内更新首次出现日，早期记录在滚动窗口结束后继续保留。
版本人数按用户名最近一次上报分组，1.0.0 系列含预发布版本。待升级名单按安装计算，
因此同一个用户可能出现在新版用户分组，同时仍有旧版设备待升级。

## 公网补采

公网 8890 由独立 sub2agent-public-telemetry.service 提供 HTTPS 采集，证书沿用
Sub2Agent Analytics CA。客户端下载时内置该 CA；云端续签时保留该 CA。公网接收器
只开放埋点写入、能力探测及聚合规则读取，原始镜像和规则写入使用内部同步密钥。

0.177 的 bi-config 配置 PUBLIC_MIRROR_URL、PUBLIC_MIRROR_DB 和 INTERNAL_RULES_URL。
现有 BI 定时任务先增量拉取公网账本并更新规则，再按安装和包 ID 与内网源数据联合去重，
最后向 Metabase 发送快照。公网镜像暂时不可达时，继续合并已缓存的公网记录和内网数据。
