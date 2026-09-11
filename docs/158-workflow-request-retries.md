# 流程请求并发重试与MCP入口核对

2026-09-12。独立流程在automatic/collaborative两模式并发start同预览/请求，真实WorkflowLibrary+TaskRuntime只创建一个待授权任务；授权后每步仅写入一次，完成后重复仍返回同任务。换requestId或模式消费同一预览被WORKFLOW_PREVIEW_USED拒绝。

父任务目录流程通过实际MCP SDK链路并发run_workflow，返回同runId；完成后重试仍为原流程，任务只含一个流程运行和11项原操作，换requestId重用预览拒绝。原有目录预览消费、父任务继续和逐项审批断言保留。两文件22项通过，ESLint与tsc -b通过。MCP采用内存传输/回环SFTP夹具，不冒充此次真实Codex会话。

从正式coreInputSchemas枚举14个requestId入口并归并证据：sessions.open→session-requests；tasks.create/commands.propose→155；directories.preview/run和transfers.upload/download→156；files.list/stat/read/edit/write→157；workflows.start/run→本记录。各测试覆盖对应的请求身份与副作用计数，并保持预览一次性和权限约束。

进一步检查发现内置AI tasks/runner.ts还有独立的启动请求缓存，不属于上述MCP schema枚举，尚需并发及冲突验证。因此A13保持未全部完成，不把MCP入口清单等同于所有客户端请求。

本轮仅扩展测试和证据，无生产行为或依赖变化。
