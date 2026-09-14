# 当前包自动、协作与 MCP 核心回归

2026-09-14，在430后的当前目录包上重新验证用户指定的基础验收主线。本轮不以发行声明检查代替自动/人机协作测试。

## 实际打包 MCP

设置TANDEM_TEST_MCP_ENTRY为当前release/win-unpacked/resources/app.asar.unpacked/dist/backend/backend/mcp/stdio.js，TANDEM_TEST_MCP_EXECUTABLE为该包TandemSSH.exe。运行stdio.test.ts和transfer-stdio.test.ts，2文件3项通过、无跳过，exit0。

包含实际stdio进程、Windows系统配对凭据、本机签名管道；自动和协作两模式通过受控SFTP夹具传输文件，检查授权与策略边界。stdio命令测试的执行端使用受控任务夹具，不把它描述为真实Linux命令或实际Codex界面操作。测试自行创建并清理独立配对凭据，不更改日常Codex配置。

证据.cache/current-core-packaged-mcp.log，2.33秒。真实Electron来自当前包，桥接业务夹具由当前源码实例化，此组合边界明确保留。

## 当前源码核心

9文件269项通过、无跳过，exit0。范围：ai/task-runner、task-recovery、session-isolation；collaboration/task-runtime、gateway、workflow-library；mcp/task-permissions、workflow-permissions、control-contract。

已读取双模式断言：人工接管后MCP返回控制错误且零写入；并发AI任务的迟到命令及终端上下文保留在原会话；恢复会话、待答问题与预算时不重放旧命令。另覆盖异用户/异配对/未授权主机、命令策略、流程参数快照、预算与授权持久化失败等既有场景。

证据.cache/current-core-modes.log，10.43秒。模型回包受测试夹具控制，没有把这些测试冒充真实第三方模型质量或所有真实主机兼容性验证。

## 未关闭范围

本轮新增当前包与源码组合的回归证据，无业务代码变更，不推高已完成数量。secret-ref执行通道选择和实现、终端剩余验收、设置迁移及发行来源仍待处理。整体67/79，F04/F10等已验证项新增证据，未因此关闭R09/F11等未完成项。

未推送Git、未触发Actions、未改公开安装包。测试没有新的失败，不额外重复全量测试。
