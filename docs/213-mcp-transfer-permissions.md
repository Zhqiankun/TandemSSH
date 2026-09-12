# MCP 文件与目录传输权限矩阵

## 模块与修改范围

仅扩展现有 `transfer-tools.test.ts`、`directory-tools.test.ts`，没有生产接口、依赖方向、共享抽象或安装包变化。SDK 工具调用进入 McpCore，再经 TransferAutomation / DirectoryAutomation 调用 TaskRuntime 的身份与主机范围校验。

## 场景与结果

在真实回环 SSH/SFTP 文件传输成功后，使用实际任务、授权文件、操作、目录预览和运行 ID 发起拒绝检查。覆盖上传、下载 × 自动、协作模式；协作模式保留实际逐项人工批准。

文件组对 list_authorized_files、upload_file、download_file、get_transfer_status、release_transfer 逐一检查其他用户、其他配对、未授权主机身份。目录组对 preview_directory_transfer、get_directory_transfer、run_directory_transfer、get_directory_run、release_directory_transfer 检查同样三个边界。合计新增 120 次拒绝断言，均返回 TASK_NOT_FOUND，且没有 result。

每次调用后任务视图、控制状态、终端写入记录保持一致；每组身份检查后，原客户端读取的传输进度、目录清单和运行结果仍与原记录一致。实际目标文件二进制内容仍完全一致，原客户端随后正常释放结束记录并完成任务。之前的目录条目数、空目录、SHA-256 和请求去重断言全部保留。

执行（app 目录）：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/mcp/transfer-tools.test.ts src/backend/tests/mcp/directory-tools.test.ts src/backend/tests/mcp/task-permissions.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/mcp/transfer-tools.test.ts src/backend/tests/mcp/directory-tools.test.ts
```

3 文件、13 项测试通过；类型、ESLint 通过。

## 失败记录与证据限制

首轮目录 4 场景因新增测试的循环变量 request 遮蔽已有预览 request，产生 JavaScript TDZ ReferenceError。改名 attempted 后重跑全部 3 文件通过；该失败属于测试构造错误，没有发现生产传输故障。

使用 SDK InMemoryTransport 注入身份，文件数据经过实际回环 SSH/SFTP；不代表新的原生凭据、stdio 或 Codex 桌面验收。目录创建/完整性与真实传输由既有成功链路覆盖，本次重点是已存在资源的拒绝读取、派发及释放。

与 212 合起来覆盖任务和传输工具的三个身份边界；文件正文编辑、流程、恢复和会话各自的完整权限范围仍需核对，不据此标记整个 F10 完成。
