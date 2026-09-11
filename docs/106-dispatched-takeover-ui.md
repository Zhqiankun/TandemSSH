# 已派发命令接管后的中文状态

2026-09-12，针对 A05 原文“已发送动作可见；未发送动作取消；状态与事实一致”补充界面层证据。

TaskPanel 测试夹具允许保持真实 TaskRuntime 的首个命令完成通知。分别使用自动与协作计划（协作首步先点击确认），确认 pwd 已写入后点击“立即接管”。结果：TaskRuntime paused-human，首操作 unknown；中文界面显示“你持有控制权”和“结果未知”，对应 .tandem-operation.unknown 保留 pwd；写入仍只有 context、pwd，后续 df/uptime 没有执行，界面不宣称已完成。

11 项中文面板测试通过，.cache/dispatched-takeover-ui-results.json；修改文件 ESLint 通过。本轮只扩展测试夹具和断言，未修改产品行为或模块依赖。此为 React/实际任务服务集成测试，SSH 完成通知受控；不替代派发瞬间的真实远端并发观察。A05 继续保留未完成状态。

alpha.5 发布同时进行：Release run 34627135287 已完成依赖安装，进入 Validate source。旧 alpha.4 开发客户端已经保留于 .cache/alpha5-release-tracking.json 的 previousClientRoot，并准备 .cache/run-public-alpha5-update.cjs；公开附件尚未验证，未运行新版本发现检查。
本轮 tsc -b 类型检查通过。

## MCP 操作结果读取补充

后续扩展 control-contract.test.ts 两种模式：自动 pwd 成功后接管，get_operation / wait_operation 仍返回同一个操作的 succeeded；协作 pwd 等待批准时接管，两接口均返回 cancelled-before-send。实际写入分别为 1 / 0 次，接管后的新请求继续返回控制权错误且无新增写入。两项 SDK→Core→TaskRuntime 集成通过。此测试区分已经完成和从未发送，不把它冒充已派发但仍在执行时的真实 SSH 验收。
补充 MCP 用例的 ESLint 与 tsc -b 通过。
