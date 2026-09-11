# 交还控制权验收补充

2026-09-12，A08 要求读取人工新增记录并使旧批准失效。

已加强现有回归：协作任务在接管后、重新授权后、新操作等待审批时，使用原 operationId/digest/revision 均不能执行；只有新操作批准后实际写入一次 pwd。原操作保持 cancelled-before-send，新操作 succeeded。

AI 快速交还竞态新增直接模型请求断言：上下文采集发生两次，交还后的请求带 /srv/manual，messages 包含人工已介入并重新授权的提示，迟到旧模型命令不执行。controlChanged 内部标志在进入模型前已转换为历史提示后清除，故验证实际消息而非要求内部标志保持 true。

本轮 task-runtime.test.ts、task-runner.test.ts 共 45 项通过，修改文件 ESLint 通过；.cache/handback-contract-results.json。仅增加验证断言，未修改生产行为、模块边界或依赖。

剩余缺口：runner.ts 的模型请求有最新 cwd、授权范围、任务工具历史和人工介入提示，但未发现接管期间人工新增终端输出的采集与注入。A08 不能据此标记完成。后续需要从已有会话输出缓冲通过受控、脱敏、有界的接口读取，并确保跨会话隔离及控制权变化时丢弃迟到结果；不可把远端文本升级为系统指令。
