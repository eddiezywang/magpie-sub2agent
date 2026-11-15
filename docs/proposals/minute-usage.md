# 分钟用量汇总协议

用户已确认：只上传汇总、不需要请求明细，允许异常退出损失当前一分钟的数据。
分类与内存累加实现见 `internal/accounting/summary.go`。运行时接入状态以
[accounting 子系统说明](../subsystems/accounting.md)为准；本文定义新服务端契约。

## 身份与分组

`sub2agent-usage/3` 的包级身份必须包含 `username` 和 `install_id`。
用户名来自本机当前登录环境，与已有埋点一致。服务端验证安装归属后，将不同
设备映射至统一用户，按用户统计；同名本地账户不天然证明是同一企业身份。
不可丢弃设备 ID：去重键为 `(install_id, summary.id)`，而非用户名或分钟。
缺失用户名不得自动合并为一名真实用户，应按安装身份隔离并标记待关联。

每份 summary 包含固定 ID、UTC `minute` 和 `groups`。minute 是请求完成、被
采集的分钟，不是开始时间或上传时间；跨分钟流式调用完成时一次累计。
按 agent、provider、实际模型、模型来源、service_tier、rules_revision、
context_tier 分组。实际模型未返回时保留请求模型并标记 requested，不能冒充
已确认的模型。上下文档位按单次 input + cache_read + cache_write 判断；严格
大于边界才升档。所有价格及金额计算留在服务端。

组内累计：attempts、最终尝试 requests、各尝试 success/failed/canceled、
handed_on，以及互不重叠的 input/output/cache_read/cache_write_5m/
cache_write_1h。reasoning 是 output 的子集，不再次加价。失败、取消、中间
handoff 的已知用量仍累计；handoff 不增加逻辑 requests。逻辑请求跨供应商时
归属于最后尝试所在组，attempts 则归属于各自实际尝试的组。

`zero_token_calls` 指所有四类原始 token 都为零的调用；现有 Record 无法区分
确实免费与上游未给用量，不能将其声明为完整计量。`cache_unknown_calls` 与
`cache_unknown_input_tokens` 单列，不能将未知缓存当作未命中。上下文不完整
时档位为 unclassified。耗时只报 sum 和正值样本数，服务端加总后相除；不能
对各分钟平均值再取平均。协议不声称能计算精确 P95。

## 分类规则

`GET /usage/aggregation-rules` 返回不可变 revision 与 models：

```json
{"revision":"rules-1","models":[{"provider":"p","model":"m","service_tier":"","above":[200000]}]}
```

无分档模型也需显式给 `above:[]`。规则只含边界，不含价格。匹配 provider、
model、service_tier 后得到 base 或 above:N；未匹配、无规则或无法确认上下文
时明确 unclassified。客户端缓存最后一个有效规则，网络/解析失败不能清空它。
同一分钟规则切换也不能合并不同 revision 的统计。服务端不得将 unclassified
偷偷按基础档计价；可单列未定价量。

改变单价可重算历史；改变上下文分档边界后，历史汇总不能恢复单次请求并重新
分档。应保存不可变的旧分档定义，报告使用的金额版本与分类版本分别记录。
当前只定义按上下文分档的规则；新增峰谷或其他非线性计价前须扩展分类契约。

## 发送和确认

`POST /usage/events` 的新 envelope：

```json
{"schema":"sub2agent-usage/3","username":"alice","install_id":"device-1","summaries":[{"id":"stable-id","minute":"2026-11-13T01:12:00Z","groups":[]}]}
```

示例空 groups 仅展示结构，真实包必须含统计。`/healthz` 必须显式声明支持 v3。
响应沿用逐 ID 的 accepted_ids/duplicate_ids/rejected_ids，但这些 ID 指汇总包，
不再是请求。服务端事务提交汇总包和去重记录后才确认；重传不重复累加。
同一分钟可以有多包或多个进程的部分汇总，均为不可变增量，不能互相覆盖。
不再上传 session、请求 ID、正文、上游账号、原始错误或客户端估算费用。

当前分钟只在内存，封存后才写持久队列，正常退出也封存部分分钟。只在明确
确认后删队列；服务器离线保留已封存汇总，不把“一分钟容忍”扩大为无限丢失。
内存和磁盘都设上限，超限必须可观测，不能静默丢统计。旧 `/events` 埋点保持
独立。历史 v2 队列须保持可恢复，不能将旧 ACK 当作新协议确认。

此改动只减少上报队列中的明细文件；本地 usage.jsonl、会话与路由记录的保留
规则另行处理，不以删除这些数据为聚合上报的前提。
