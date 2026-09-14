# AI 创建审计失败时取消未绑定任务

2026-09-14，继续A15。发现AiTaskCoordinator.initialize先创建底层TaskRuntime任务，再写agent.created审计；审计抛错时协调器run尚未登记，底层任务却留在awaiting-authorization，形成没有模型执行器接续的可授权任务。

修复仅在ai/tasks/runner.ts的创建编排：agent.created审计失败时，通过已有TaskRuntime.cancel取消该任务，然后向调用方抛出审计错误。取消保留终态记录而非删除，create现有失败处理仍移除请求占位，后续重试可以创建新的任务。没有改变授权签发、审计策略、模型预算、API契约或共享抽象。

新增实际协调器/任务运行时回归，以可控审计端口拒绝第一次创建：修改前旧任务仍等待授权，用例失败。修复后旧任务cancelled，人工尝试授权返回TASK_STATE_INVALID，模型请求0次、SSH写入0次、控制权human；同一请求重试审计成功后得到新taskId并进入awaiting-authorization，模型只调用一次进行规划。

任务协调与恢复2文件31项通过；补旧任务不可授权断言后协调器18项通过。TypeScript、ESLint通过。日志agent-audit-create-before.log、agent-audit-create-after.log、agent-audit-create-final.log、agent-audit-create-tsc.log、agent-audit-create-lint.log。

证据是实际运行时加受控审计拒绝，不是本轮真实磁盘不可写或打包桌面故障注入。本轮未重建发布目录包，A15执行中审计缺口与中文可见性等完整范围仍继续，整体57/79。未推送Git或触发Actions。
