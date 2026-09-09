# 父任务中的流程恢复

2026-09-09，继续原始自动/协作、中文与 MCP 目标。本阶段保存 AI/MCP 父任务及其调用流程的关系，恢复后完成剩余步骤，再回到父任务。目录内部游标与部分文件检查点继续独立接入，不把未支持资源伪装为未执行。

## 契约与文件责任

主智能体负责实现与验证。TaskRuntime 拥有根计划、流程运行记录、活动流程 ID、工作目录、步骤位置和操作结果；检查点保存这些可信快照，页面不能提交或修改它们。WorkflowLibrary 通过 TaskRuntime 的只读结果入口读取旧结果与新结果，不重建旧执行能力。AiTaskCoordinator 记录正在等待的流程/调用 ID，恢复后等该流程结束再调用模型；原工具调用不重新派发。

依赖方向：中文恢复 UI/MCP → RecoveryService → TaskRuntime/AI 协调器 → 既有 WorkflowLibrary 与 OperationGateway。恢复格式属于 collaboration/recovery，规范化 AI 等待关系属于 AI 状态，不新增 common/utils 抽象。旧操作仅供查询，不导入网关队列、旧批准、请求缓存或本地文件授权。

恢复保留流程 ID（按新父任务归属核验），创建新任务和控制上下文。原计划与版本快照不随流程库修改改变。新授权前没有模型或 SSH 派发；完成子流程后父任务回到 ready，不能错误地把整个父任务标为 completed。已完成步骤不重跑，未知结果仍须人工核对。新的文件槽位重新授权，部分资源仍明确拒绝恢复。

格式向后读取旧记录；旧版本只有“资源待恢复”而没有父流程关系的记录不能猜测恢复。新增流程关系、操作归属、活动位置与 AI 等待引用均需校验。

## 验收

自动和协作父任务中，首步后保存，重启恢复只运行剩余步骤；子流程结束后父 AI/MCP 能读取完整结果并继续执行下一条操作。旧操作可查询但不可批准/派发。模板被修改不影响快照；跨用户/客户端/主机、公钥变化、缺失运行记录与孤立操作引用拒绝。模型在父流程运行时不提前继续。类型、lint、相关回归与 Windows 本机模型/真实 SSH 验证分别记录证据。

## 已实现行为

中文任务面板已开放父任务“暂停并保存任务进度”。恢复详情显示原流程名称、版本、步骤位置和此前执行结果；恢复后的流程卡片说明已保留原结果。MCP 沿用四项恢复工具，不增加第二条执行通道，仍共 38 项工具。

检查点保存根计划、每个流程的冻结计划与运行摘要、活动流程 ID、原工作目录、步骤位置和 AI 等待关系。恢复创建新父任务，保留流程 ID 并记录原任务 ID；不依赖流程库仍保留原模板。旧操作可以通过流程结果入口查询，不能通过旧 ID 批准或派发。新授权表单允许为父任务后续命令设置程序范围，并与当前流程精确步骤共用本次任务的预算与权限。

AI 恢复后先等待子流程结束，把真实的旧结果和新结果写回原工具响应，再请求下一轮模型。尚未完成的原 run_workflow 不重新派发；模型轮次不归零。未知步骤仍由人工核对，跳过时同时保留父任务和子流程的失败标记。子流程结束清除暂停错误并返回父任务 ready；父任务最终结束才持久化 completed。恢复列表区分“已完成”与“已被新任务接续”，已完成记录不能重新恢复。

## 模块边界

- `collaboration/recovery/workflow-state.ts` 新增恢复格式中的流程快照校验，复用原计划验证器；`schema.ts` 核验活动位置、根计划和每条操作的流程归属。
- `TaskRuntime` 捕获及重建父子关系，公开只读流程操作查询，继续通过原网关执行；`WorkflowLibrary` 仅改用此公开查询入口。
- `AiTaskCoordinator` 与 AI 恢复格式负责等待关系和模型历史；UI 仅展示后端详情及提交本次人工授权，不重建可信快照。
- 没有新增共享 common/utils 模块、外部服务或恢复旧批准的接口；依赖方向保持 UI/MCP → Service → 任务/AI 核心 → 既有执行与存储端口。

## 实际验证

应用组 `npm test -- --exclude src/backend/tests/collaboration/pty-integration.test.ts`：458 文件 / 3299 项通过，4 项按既有条件跳过；真实 PTY 组独立运行：1 文件 / 10 项通过。使用 PortableGit Bash、长路径和原始帧记录。最后补充父任务完成记录后，任务恢复、AI 恢复与中文界面组合再次验证：3 文件 / 33 项通过。前一全库结果不代替该最终修改的专项验证。

最终类型检查、全库 lint、中文静态键检查、前后端生产构建通过，缺失翻译键 0。Windows 包使用已核验的本机 Electron 43.2.0 缓存与已有匹配原生模块构建，未修改正式 CI 的 Spectre 或原生重建要求。最终包原生探针验证 13 项依赖；打包 MCP/隔离 Codex 2 文件 / 3 项通过，Codex 实际发现 38 项工具。Codex 探针仅使用本机 MCP 初始化和清单 RPC，不发送模型任务，不修改用户日常配置。

真实 Windows 最终包完成 4 个正常重启场景：MCP 自动、MCP 协作、内置 AI 自动、内置 AI 协作。使用本机 SSE 模型与真实回环 SSH。首步创建文件，在第二步前保存并删除原流程模板；应用正常退出后重启，恢复保留原运行 ID 和位置 1，新授权前第二个文件不存在。重新授权后只执行剩余步骤，流程结果包含恢复前后两项成功操作，父任务继续创建第三个文件。协作模式对子流程剩余操作和父任务后续操作分别批准；AI 调用数保持 3 → 5，等待子流程期间不提前请求模型。四个场景均验证首个文件时间戳未变、后续文件内容正确，以及最终检查点状态为 completed。

最终截图已人工核对中文父任务与子流程完成状态、恢复说明和 AI 5 / 8 模型轮次。实际配置产生 8 份 TTR1 加密记录，未出现测试任务名、命令或模型标记的 UTF-8/UTF-16 明文；这仅证明测试标记未明文出现，不声称可以识别全部用户硬编码秘密。

最终桌面证据：`.cache/desktop-observation-report-9ad30893-5098-49a5-8871-1098ee8bf383`，逐场景结论在 `restore/parent-recovery-result.json`，原始 SSH 输入/输出与截图保留在同目录。加密核验：`.cache/parent-recovery-desktop-encryption.json`。

主要日志（位于 `.cache`）：`parent-recovery-ci-application-verified.log`、`parent-recovery-ci-terminal-tests.log`、`parent-recovery-finish-verified.log`、`parent-recovery-delivery-types.log`、`parent-recovery-delivery-lint.log`、`parent-recovery-delivery-localization.log`、`parent-recovery-delivery-build.log`、`parent-recovery-delivery-package.log`、`parent-workflow-recovery-desktop-delivery.log`、`parent-recovery-native-probe.log`、`parent-recovery-packaged-mcp.log`。

## 发现并修复的问题

初次桌面脚本在 Shell 授权探测结束前调用流程，正确收到 WORKFLOW_IN_PROGRESS；已等待真实 ready 状态后重测。第一轮截图条件误读子流程完成标记，已改为核对父任务和 AI 协调器最终完成状态。全库测试曾因断言读取到 running 而非随后 awaiting-approval 失败，已等待实际审批状态且保留未批准前不执行的断言。

流程完成后残留 TASK_RECOVERY_SAVING 错误，以及 MCP 父任务 finish 后检查点仍显示中断，均已修复。第一次完成记录保护放置错误导致两项测试失败，已将判断放到 restoreRecovery，并通过最终 33 项及最终包四场景验证。失败日志保留，不删除断言或隐藏错误。

## 仍未交付的范围

目录内部游标、部分上传/下载资源检查点尚未与任务恢复组合；旧版本缺少父流程快照的检查点不能猜测恢复。普通流程文件槽位需重新授权，全部文件/目录跨重启组合仍未取得桌面证据。Shell 环境变量、函数和任意交互程序状态不在恢复格式中，新会话仍需核对 Shell 上下文。

本阶段桌面证明正常退出重启，不证明掉电或所有并发 I/O 时序。已有 Windows ConPTY/Bash 兼容风险按第 32 份文档保留。实际跨版本在线更新、完整认证/跳板、监控/隧道权限、备份与 F01–F15/B01–B16/R01–R11/A01–A37 总验收继续；完整目标未完成。上一提交 77ea6a4 的云端 CI 34342464095 已成功，本次提交的云端结果另行核对。
