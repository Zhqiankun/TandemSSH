# A07：真实 MCP stdio 接管后拒写

2026-09-12，按 docs/06-delivery.md 的 A07“外部 MCP 抢写：不具控制权时返回 CONTROL_BUSY/STALE_CONTROL”补齐真实 stdio 证据。

## 实际链路

扩展已有 transfer-stdio.test.ts，强制指定当前构建的 dist/backend/backend/mcp/stdio.js，使用独立 Node 进程的 StdioClientTransport、MCP SDK、Windows 签名本地管道、SystemPairingSecretStore 临时系统配对凭据、McpCore 和 TaskRuntime。没有使用 InMemoryTransport 替代本轮传输。

同一场景先完成真实 SFTP 二进制上传/下载，再分别验证自动和协作模式：

- 接管前提出 pwd：自动模式完成；协作模式停在 awaiting-approval。
- 通过 SessionControl.humanInput 接管后，自动模式原成功记录保留，协作模式未发送操作变为 cancelled-before-send。
- MCP 并发发出两个新的 run_command 请求，均返回 CONTROL_BUSY 或 STALE_CONTROL，观察到的终端写入数组完全不变，控制者仍为 human。
- get_operation、wait_operation 仍能读取正确原状态。
- MCP 客户端退出后任务取消，没有插入额外中断字节，没有关闭人工会话，人工可继续输入。

## 结果和边界

真实 stdio 两模式 2 项通过，未跳过，报告 `.cache/native-mcp-control-results.json`；内部控制契约和签名桥接 11 项回归通过。ESLint、TypeScript 通过。测试创建的系统凭据、管道、文件夹具在 finally 清理；未改日常 Codex 配置，也未调用 Codex 模型。

文件传输使用真实回环 SSH/SFTP；命令写入端采用受控观察端口记录字节，不能称为本轮实际执行远端 pwd。拒写要求以网关没有调用写入端口和实际 MCP 错误响应证明；既有真实 PTY/桌面人机协作证据继续独立保留。本轮不是打包安装版的 Codex UI 操作截图。

A07 按该接管后终端抢写范围标为 verified；F10 的全部工具权限矩阵、文件工具的独立限制及其他完整验收项不由本项替代。生产代码未修改，此轮新增验收不在已发布 alpha.12 标签的测试文件内。
