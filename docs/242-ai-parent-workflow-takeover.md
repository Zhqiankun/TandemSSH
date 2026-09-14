# 内置 AI 父流程中途接管与恢复矩阵

## 范围

扩展 app/src/backend/tests/ai/workflow-task.test.ts，直接组合生产 AiTaskCoordinator、TaskRuntime、WorkflowLibrary 和 SessionControl。仅测试夹具新增指定第二步挂起和第三步选项；本轮未改生产模块、API 契约或依赖方向，也没有共享抽象。

模型响应与命令执行端口为受控夹具，不调用收费模型、不执行远端命令。本记录不是桌面端或 Linux PTY 实测，也不将 A27 整项改为通过。

## 四种验收场景

自动模式与协作模式，分别执行人工接管后跳过、明确重试，共四种组合：

1. 第一条 pwd 成功，第二条 printf 已发送且执行未完成，此时人工输入。
2. 人工输入进入同一个控制器，父 AI 进入 paused-human；观察窗口内模型请求数和命令写入数不增加。
3. 未明确处理未知结果时再次授权返回 RECONCILIATION_REQUIRED，没有额外命令。
4. 人工选择跳过后，只执行第三步；选择重试时，仅重试第二步再执行第三步。两者均保留相同 workflowRunId，成功的第一步不重跑。
5. 协作模式恢复后仍须分别批准待执行步骤，不因重新授权变为自动模式。
6. 被接管的操作保留 unknown 和人工决策记录；重试新增操作记录，不覆盖原记录。跳过显示 completed-with-errors，重试且后续成功可完成。
7. 模型在 run_workflow 同一批次给出的额外命令收到 WORKFLOW_RESULT_REVIEW_REQUIRED，不能与流程步骤混入执行。

## 验证结果

vitest run src/backend/tests/ai/workflow-task.test.ts src/backend/tests/collaboration/parent-workflow.test.ts：2 文件、28 项通过。TypeScript 和该文件 ESLint 通过。

补充重试矩阵时，两项断言曾因自动编辑未匹配 LF 换行而遗漏新增记录预期：实际返回 4 条记录，旧断言仍期望 3 条；修正测试后通过。该失败不是生产缺陷，不删除未知记录来迎合断言。

仍需将本轮第二步接管矩阵与最新桌面、实际终端执行、用户可见审批和恢复交互整合验证。没有提交、推送或触发 Actions。
