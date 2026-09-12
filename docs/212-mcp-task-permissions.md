# MCP 任务工具权限矩阵

## 范围与职责

本轮补充 `app/src/backend/tests/mcp/task-permissions.test.ts`，不改变生产行为、数据结构或共享抽象。MCP SDK 负责工具协议，McpCore 适配身份和参数，TaskRuntime 负责任务归属与主机范围；测试通过这三个实际入口验证拒绝行为。

## 实际验证

对 automatic、collaborative 两种模式分别建立原客户端任务并由人工授权，提交 pwd。自动模式等待 succeeded，协作模式等待 awaiting-approval。然后分别改为其他用户、其他配对客户端、没有该主机权限的身份，调用以下工具：

- get_task
- get_operation
- wait_operation
- run_command
- finish_task
- cancel_task
- list_authorized_files

6 个矩阵场景中的 42 次调用均返回 TASK_NOT_FOUND，响应没有 result。每一次拒绝后均核对原任务完整视图、控制状态和写入记录没有变化。与现有 control-contract.test.ts 合计 2 文件、10 项测试通过；TypeScript 与 ESLint 通过。

验证命令（app 目录）：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/mcp/task-permissions.test.ts src/backend/tests/mcp/control-contract.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/mcp/task-permissions.test.ts
```

## 证据边界

使用 SDK InMemoryTransport、真实 McpCore、TaskRuntime 和 TransferAutomation；身份由测试注入，命令执行端为受控写入记录端。虽然复用了真实回环 SFTP 夹具，本矩阵没有执行文件传输，不构成真实远端命令或原生 stdio 认证的新增证据。那些链路的证据另见 208、209、211。

本轮没有发现新的生产缺陷，不把通过的任务工具子集当作全部 38 工具验收。文件、目录、流程和恢复工具仍需逐项核对已有证据及缺口。开发分支上的新增测试也不代表 alpha.12 安装包新增了功能。
