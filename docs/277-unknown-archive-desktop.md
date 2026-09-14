# 未知命令人工确认归档的真实桌面验收

2026-09-13，承接 276。本地重新 build 并生成 Windows 目录包，包含 276 的归档代码。未推送或发布。

实际 Windows TandemSSH + Alpine 3.24.1 SSH + 本机 HTTP 模型，分别执行 automatic / collaborative。两种模式均完成第一步 printf，第二步 sleep 运行中人工接管并发送 Ctrl+C，终端人工命令返回 marker，然后取消任务。保留两条操作 succeeded / unknown，第三步 pwd 未派发；协作模式前两步均经过逐条批准。

真实 HTTP / UI 验证：

- 无确认集合、外来 UUID、重复 UUID 均返回 400 TASK_ARCHIVE_RECONCILIATION_REQUIRED。
- 非 UUID、额外字段均返回 400 INVALID_REQUEST；无身份请求返回 401/403。
- 点击实际“归档并释放资源”按钮，浏览器调试协议观察到真实 confirm 对话框及中文提示“请先在服务器核对执行结果”。第一次拒绝确认，任务仍为 cancelled，第二条操作仍为 unknown；第二次接受确认，任务从活动列表移除。
- 两次对话框均由原生 Page.javascriptDialogOpening 事件观测，并用 Page.handleJavaScriptDialog 作出选择；未替换 window.confirm 或直接伪造确认函数结果。
- 归档期间模型调用次数未增加；当前取消任务不恢复执行。
- 应用正常退出并释放端口后，直接读取该测试 profile 内 tandem-audit 分片文件，两个 task.archived 事件均保留 cancelled 状态及对应 reviewedUnknownOperations={id,status:unknown}。这是退出后的磁盘证据，不只检查内存数组。

成功报告：`.cache/desktop-observation-report-52bb016a-2264-436f-be80-e68b115e9860`，`task-interrupt-result.json`、`archive-persistence.json`、`interrupt-observation.jsonl` 与拒绝/接受后的截图。已查看 `archive-declined-collaborative-cancel.png`，可见第一步成功、第二步结果未知、取消后的核对提示及归档按钮。原生确认框文字与选择由协议事件记录证明，截图是关闭对话框后的页面，不声称截图包含确认框本身。

失败记录：首轮 `979edf47-678d-4750-8c3f-072757242d0c` 在旧接管脚本的 8 秒耗时阈值中止，发生在归档前，人工 marker 已返回。归档场景改为保留人工 marker 成功检查、单独记录耗时，不再将这一额外速度阈值作为归档通过条件。第二轮测得 automatic 323 ms / collaborative 295 ms；不据此否认首轮慢响应，也不将本轮归档证据扩展为普遍接管延迟保证。

限制：测试本轮确认归档、实际 HTTP 错误与落盘记录；跨用户和 MCP 身份拒绝见 276 运行时测试，本轮未建立第二个登录用户。文件类未知结果仍不能通过命令归档确认绕过清理。旧的终端协议包装命令回显仍可见（246），未在本轮修改。

F08 / R05 此子功能完成真实验收，但整体时间线、其他归档与记录边界仍未闭环，35/79 计数不变。构建日志 `.cache/archive-native-build.log` / `archive-native-package.log`；运行日志 `.cache/archive-native-desktop.log`。

环境清理：桌面观察器退出码 0；按准确 manifest 停止测试 VM，停机返回 forced=true，启动器退出码 0。VM 超时强制清理与应用正常退出分别记录。
