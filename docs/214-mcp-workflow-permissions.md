# MCP 保存流程权限矩阵

## 文件责任与边界

新增 `app/src/backend/tests/mcp/workflow-permissions.test.ts`，不修改生产接口或引入共享抽象。通过真实 SDK 工具调用、McpCore、WorkflowLibrary 和 TaskRuntime，验证流程元数据、预览和父任务的不同归属规则。

## 实际场景

自动、协作模式分别保存单步 pwd 流程，人工授权父任务，产生独立预览和父任务预览，再执行父任务流程。协作模式等待人工批准后执行。完成后使用其他用户、其他配对和未授权主机的身份调用六项工具：list_workflows、get_workflow、preview_workflow、start_workflow、run_workflow、get_workflow_run。

同用户、同授权主机的其他配对可读取保存流程目录及详情，这是正常共享行为。它不能使用原配对预览、绑定原父任务或读取原运行结果。其他用户和未授权主机均在相应范围拒绝访问。

共 36 次权限断言，其中 4 次合法元数据访问、32 次拒绝。拒绝错误码分别核对 HOST_NOT_FOUND、WORKFLOW_NOT_FOUND、SESSION_NOT_FOUND、WORKFLOW_PREVIEW_NOT_FOUND、TASK_NOT_FOUND。每次调用后原任务、控制状态、写入记录及任务数量不变；恢复原身份后可读取同一完整运行结果。非法 start_workflow 没有创建第二个任务。

## 验证

app 目录执行：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/mcp/workflow-permissions.test.ts src/backend/tests/mcp/directory-workflow.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/mcp/workflow-permissions.test.ts
```

2 文件、4 项测试通过；类型和 ESLint 通过。既有目录流程仍执行真实回环文件传输并保留逐项批准验证。

新增矩阵使用 InMemoryTransport 注入身份，命令执行端为受控写入端，不能据此声称新增真实远端 Shell 或 Codex 原生启动证据。该矩阵覆盖六项流程工具的当前身份边界，并非全部产品验收；MCP 的恢复、文件正文与会话权限证据仍需继续核对。未发布新安装包。
