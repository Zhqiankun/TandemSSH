# 内置 AI 创建请求重试验收

2026-09-12。验收范围为 A13：同一 requestId 重复或客户端重试，返回原任务/操作，不重复触发副作用。

## 文件责任与依赖

AI 创建请求缓存属于 backend/ai/tasks/runner.ts 的 AiTaskCoordinator，执行仍进入 TaskRuntime。此次仅扩展 backend/tests/ai/task-runner.test.ts；没有新增共享抽象、生产依赖或用户行为变化。

## 实际验证

自动与协作模式分别同时调用两次 create：共享同一 Promise、task 和 run。等待授权时再次请求仍返回原结果，只有一个 AI run、一次规划模型调用、零终端写入。相同请求 ID 改变目标、模式、提供商、模型、会话或轮次上限均返回 REQUEST_CONFLICT。

协作模式等待单步审批时重复创建，不增加模型请求，终端只有上下文准备写入；批准后才执行 pwd。两模式完成后再重复创建，任务仍只有一个操作、模型总调用三次（规划、提出命令、总结），命令只写入一次。

已有 task-archive 测试继续验证：完成后归档，原请求返回 AI_TASK_ARCHIVED，改目标返回 REQUEST_CONFLICT，不能重放归档任务。

运行结果：Vitest task-runner + task-archive 两文件 16 项通过；修改文件 ESLint、tsc -b、git diff --check 通过。使用本机模型流和会话执行夹具，并未连接收费模型或真实生产服务器。

## A13 证据归并

155–158 已覆盖 MCP schema 的 14 个 requestId 入口，包括并发提议缺陷修复、会话打开、任务创建、命令、文件读写、传输、目录及流程。本记录补齐内置 AI 独立创建缓存，A13 标记已验证。此结论指既定请求缓存生命周期中的重试与已归档拒绝重放，不声称新增跨进程持久化幂等存储。

本轮测试尚未包含于已发布 alpha.7；155 的并发提议生产修复也在后续开发分支中。