# 人工核对未知命令后的任务归档

2026-09-13，F08 / R05 的局部补齐。主智能体独立实施。

问题：任务取消会将已发送但结果不明的命令保留为 unknown；原归档只接受 succeeded/failed/cancelled-before-send，取消任务又不能重新授权，用户核对真实效果后仍无归档入口。

职责与契约：OperationGateway 保留操作状态及文件/审计风险边界；TaskRuntime 负责任务所有权、终态、精确人工确认集合和归档审计；HTTP 只验证输入并调用运行时；UI API/workbench 传递确认集合，TaskPanel 显示中文确认。没有新增共享抽象、反向依赖或数据库迁移。

- TaskView 新增 archiveReviewIds，仅当终态任务所有操作可直接归档或属于无审计缺口、无 fileResult 的未知 terminal.command 时返回需要确认的 ID。
- POST /tandem/tasks/:id/archive 接受可选 reviewedUnknownOperationIds（UUID 数组，最多 4096，strict body）；旧空对象请求行为保持不变。
- 运行时要求人工调用者及任务所有权，确认集合必须无重复并精确匹配当前不可直接归档的操作。缺失、额外/外来 ID、MCP、其他用户均不能绕过检查。
- 只有未知命令得到这一人工归档路径。文件未知、临时路径、可能已提交、待清理、审计缺口等仍阻止归档。
- UI 点击归档时，若有未知命令则提示先在服务器核对实际效果，再明确确认；取消确认不发送归档请求。确认后不重发命令，不将 unknown 改为成功，不恢复取消任务。
- task.archive-requested / task.archived 元数据保留 reviewedUnknownOperations 的 ID 和 unknown 状态，原操作审计不改写。请求审计写入失败不会释放任务，重试仍需要提供精确确认集合。

验证：4 个测试文件 218 项通过，包括真正运行时接线的中文 TaskPanel 测试、拒绝确认后保留任务、接受确认后无新终端写入、MCP/跨用户/错误集合拒绝、审计失败保留记录、文件 unknown 和 auditGap 不可绕过。TypeScript、ESLint、缺失翻译键检查通过（0 missing）。日志 `.cache/archive-review-tests-final.log`、`archive-review-tsc.log`、`archive-review-lint.log`、`archive-review-locales.log`。

剩余：本轮 HTTP schema 已接线但未单独执行真实 HTTP 契约验收；当前目录包未重建，尚未进行原生桌面确认与持久化审计读取验收。文件类未知操作仍需自身的核对/清理收尾方案。F08/R05 不标记整体完成，35/79 验收计数保持不变。未提交、推送、打标签或触发 Actions。
