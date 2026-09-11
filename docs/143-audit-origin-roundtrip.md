# 多来源操作记录的真实日志往返

2026-09-12。task-runtime.test.ts 将现有 TaskRuntime/SessionControl/OperationGateway 直接接到 AuditJournal，使用限定前缀的临时目录写入真实 JSONL，再新建日志读取实例查询。没有手工构造历史数据来替代运行时记录。

人工发起流程(workflow)、内置AI任务(任务来源assistant/操作来源agent)、MCP三种来源分别在automatic/collaborative运行，共六条链。每条建立任务、由human授权、提交pwd；协作链另由human单次批准；等待完成后结束任务。读取历史验证 task.created、task.authorization、operation.proposed/intent/completed、协作批准及task.completed都有匹配的任务、主机快照、会话、模式和来源；操作策略版本/判断、cwd、退出码0及可见输出均完整。测试输出中的API_KEY值不能出现在返回历史中。

实际任务运行时测试文件37项通过。首轮查询用了100条，真实接口最多50而拒绝；测试改用正式上限50后通过，生产限制未改变。临时目录按父目录及前缀确认后finally清理，控制会话关闭。该链的执行器仍是测试端口，不声称新增了真实SSH或Codex协议执行验收；此前实机来源证据见79。

本轮只新增测试和证据，生产模块、协议及依赖不变。R05/F08的文件操作、失败/中断及完整界面回放矩阵仍需归并，不能用这些成功命令链替代整个执行时间线验收。
ESLint 与 tsc -b 类型检查通过。
