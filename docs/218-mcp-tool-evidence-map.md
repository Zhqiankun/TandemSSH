# MCP 38 项工具证据清单

## 本轮新增

`task-permissions.test.ts` 增加 automatic/collaborative 的 start_task 校验：其他用户、未授权主机、未知会话均返回 SESSION_NOT_FOUND，不创建任务、不写终端、不改变控制。另一个获准配对可请求自己的任务，初始 awaiting-authorization，控制仍归人工。

`production-session-list.test.ts` 直接运行生产 listSessions 与 McpCore：向 SessionManager 传当前用户，过滤主机范围及可选 hostId，仅返回 id/hostId/hostName/connected/control。带有密码、SSH 连接对象和历史正文的输入不泄露这些字段。读取会话公共状态不要求开启 readTerminal；同用户合法配对可见同一会话状态。

仅修改测试和文档，无新生产模块、共享抽象或依赖变化。SessionManager 为替身，因此不把本轮称为真实 SSH 列表集成；任务创建用真实 TaskRuntime，写入端为观察端口。

## 工具覆盖核对

以当前 server.ts 的注册清单为准，共 38 项。下表是证据导航，不能单独替代源码、运行结果或每项范围限制。

| 组 | 工具 | 当前证据 |
| --- | --- | --- |
| 身份与会话（6） | get_status、list_hosts、list_sessions、open_session、read_terminal、start_task | stdio.test.ts、production-session-access.test.ts、production-session-list.test.ts、session-requests.test.ts、task-permissions.test.ts；208、217、本篇 |
| 任务操作（6） | get_task、run_command、get_operation、wait_operation、finish_task、cancel_task | control-contract.test.ts、task-permissions.test.ts、transfer-stdio.test.ts；208、212 |
| 保存流程（6） | list_workflows、get_workflow、preview_workflow、start_workflow、run_workflow、get_workflow_run | workflow-permissions.test.ts、directory-workflow.test.ts；214 |
| 正文与属性（6） | list_directory、stat_file、read_file、get_file_content、propose_file_edit、propose_file_write | production-file-tools.test.ts；215 |
| 文件传输（5） | list_authorized_files、upload_file、download_file、get_transfer_status、release_transfer | transfer-tools.test.ts、transfer-stdio.test.ts；213 |
| 目录传输（5） | preview_directory_transfer、get_directory_transfer、run_directory_transfer、get_directory_run、release_directory_transfer | directory-tools.test.ts；213 |
| 恢复（4） | list_saved_tasks、get_saved_task、save_task_progress、restore_task_progress | collaboration/recovery/execution.test.ts；216 |

全部工具经统一 coreInputSchemas 校验，工具没有授予人工身份、批准、原始终端输入接口；配对/撤销与生产配置的独立证据见 209–211。会话输出与任务结果的读取权限不同，流程元数据与运行预览的共享规则也不同，不能把所有跨配对访问一概视为违规。

## 本轮整组回归

明确设置 TANDEM_TEST_REQUIRE_STDIO=1 和当前编译的 stdio 入口，执行 MCP 全目录、真实文件读写集成、任务恢复：**19 文件、87 项通过**，无跳过。报告 `.cache/mcp-permissions-regression.json`。新增两文件的 TypeScript、ESLint 通过。

此次原生 stdio/SFTP 证明实际本机协议与文件效果；身份矩阵中 InMemoryTransport 注入的是核心可信身份，不声称绕过原生认证。恢复存储测试使用磁盘加密和测试密钥，不声称本轮桌面重启。

## 后续收尾

38 项工具已经逐组定位身份权限及合法行为证据。F10 不再笼统记作“所有工具矩阵未逐项闭环”；下一步核对 MCP 经真实共享策略执行器命中黑名单、任务授权范围时的拒写结果，再据原始验收定义判定是否完成。完整产品中的文件、流程和恢复各自其他验收项仍独立保留，不由本清单替代。此轮未发布新安装包。
