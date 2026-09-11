# 自动协作控制专项复核

2026-09-11，回到原始基础验收，按具体断言复核，不用测试总数代替全部产品要求。

## 本轮可确认的条目

| 条目 | 直接证据 |
| --- | --- |
| A04 排队命令中接管 | control.test 的迟到准备阶段在 takeover 后只能保留 manual 写入；gateway.test 在 operation.intent 审计等待期间接管，结果 cancelled-before-send，writes 只有人工输入。旧租约同任务重新交还也不复活。 |
| A06 模型迟到响应 | ai/task-runner.test 在模型工具响应阻塞期间人工输入并快速重新授权，释放旧响应后没有 printf stale 写入；新请求使用 /srv/manual，新会话上下文得到使用。 |
| A10 策略变更与审批竞态 | 命令在 intent 审计期间策略 revision 增加后无写入；新增文件用例同样取消派发且无 I/O。已开始的文件分块在 revision 变化后仅有 first，不执行 second，状态保留 unknown。生产 savePolicy 在异步保存前同步接管所有用户会话，重新授权再次读取并核对策略 revision。 |

这三个条目可按上述原文标记 verified。A03 标签切换、A05 已派发状态可见、A07 外部 MCP 错误契约、A08 交还后的记录衔接及 R03/R04/R06 的完整入口范围继续单独核对，不因本表一并变成完成。

## 实际执行结果

当前源码的 control、gateway、file-gateway、task-runtime、AI task-runner、AI engine 共 6 文件 / 107 项通过；其中自动模式、协作审批、预算耗尽需人工增加并重授权、代理不能自行授权等断言也已阅读。新增两项文件策略竞态，原“canonical paths and policy changes”用例实际只覆盖路径，已将其标题纠正。类型与新增测试 ESLint 通过。结果 .cache/core-control-acceptance-results.json、.cache/core-control-acceptance-tests.log。

当前安装的 Codex CLI（7ac07f4ce733f89a）与实际打包 MCP stdio 再次验证，2 文件 / 3 项通过：桌面授权前拒绝执行、授权后受限命令、断开失权及文件传输。配置由参数临时覆盖，配对使用测试 UUID 并清理，未改日常配置、未调用付费模型。Codex 实际发现 38 个工具，configurationValidated=true，记录 .cache/codex-mcp-integration.json；日志 .cache/core-codex-mcp-tests.log。serverInfo 仍显示早期 0.1.0-alpha.0 版本标识，这是待修正元数据，不将工具发现成功解释为版本标识正确。

此前 Windows/真实 Alpine 的原始结果也已重读：56 的 linux-desktop-result.json 有自动/协作、同 Shell 环境和 cwd、实际文件、人工接管/交还记录；77 的 history-export-revocation-result.json 有撤销后新请求拒绝、人工仍可输入和禁止文件不存在。本轮未重新启动 Linux VM，不把旧记录称为本轮实机重跑。当前 107 项多数使用可控传输/模型夹具，以便稳定制造竞态；它们不证明模型推理质量或所有远端环境。

后续已修正 MCP 旧版本标识，根包版本成为唯一来源；实际 Codex 报告与开发包版本一致，升级夹具也通过包级版本比对。见 [92](92-mcp-build-version.md)。公开旧包的标识不会因此自动改写。
