# MCP 共享策略拒写与结果映射

## 发现与修复

在真实 stdio、Windows 系统配对凭据和签名本机管道上，automatic/collaborative 各自创建已授权 pwd、目录 /srv 的任务。请求 pwd -P（精确参数黑名单）与 cwd=/outside（本次目录范围外）。共享执行器已经拒写，但原 MCP 返回普通 result，operation.status 为 awaiting-approval、taskState 为 paused-error，容易让调用方误判为还能批准。

`mcp/core.ts` 的 commands.propose 现在将 decision.outcome=deny 映射为 POLICY_DENIED；对 awaiting-approval 且当前任务实际 paused-error 的结果，返回当前拒绝原因。当前状态通过 TaskRuntime.get 读取，避免沿用 submit 返回时的旧快照。已有 server.ts 继续输出中文错误。任务、审计、策略执行器和人工审批接口没有改动，不引入共享抽象。

## 验证与复现过程

- 原版在两种模式均复现：黑名单返回普通等待审批结果，测试失败。
- 加上黑名单映射后，目录越界复现同类错误。
- 首次使用 submit 快照检查暂停未奏效；读取当前状态后，两种模式分别得到 POLICY_DENIED 与 TASK_SCOPE_EXCEEDED，观察端写入数组完全不变。
- 使用独立任务逐项校验后取消，随后保留完整的真实 SFTP 双向传输、普通 pwd、协作等待审批、人工接管并发拒写、退出归还控制测试。

完整相关回归：MCP 目录、production-file-tools.test.ts、collaboration/recovery/execution.test.ts，**19 文件、87 项通过**。机器报告 `.cache/mcp-policy-result-regression.json`；TypeScript 和 ESLint 通过。

原生 stdio 使用当前编译入口与 SDK 子进程。McpCore/TaskRuntime 由测试宿主运行当前源码，终端命令端为受控字节观察端，不能称为本轮实际远端 Shell 执行。文件测试经过真实回环 SSH/SFTP。临时凭据、管道与测试连接由夹具清理。

## F10 验收结论

对照 01-product.md 原始 F10“本机接入，共用策略和会话控制；首版仅开放有限工具”：

- 本机 stdio、系统凭据、签名管道及撤销：208、209、211 与当前原生回归。
- 共用策略与控制：本篇共享 TaskRuntime/OperationGateway 黑名单和目录拒写，208 接管拒写；64 保留实际 Linux PTY 与桌面两种模式证据。
- 有限工具、中文描述与无人工授权/原始输入工具：实际 SDK 目录为 38 项，server.test.ts 与原生目录断言；逐组身份权限见 212–218。
- 配置使用及复制反馈：210、211，既有 Codex 发现证据见 13、16。

据这些直接证据将 F10 在当前开发源码范围标为 verified。这个结论不表示全部产品完成，也不替代 R/F/B/A 中各文件、流程、隐私、恢复需求。新修复尚未进入已发布 alpha.12 安装包，后续仍须通过 Actions 发布验证。
