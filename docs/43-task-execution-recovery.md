# 任务执行跨重启恢复

2026-09-09，继续原始目标。本阶段已连接独立任务执行检查点、中文核对恢复和 MCP 领取。它不替代只读脱敏历史，也不恢复旧控制权。

## 契约与文件责任

主智能体负责设计、实现、测试和交付。TaskRuntime 提供当前任务的可信执行快照与新会话恢复入口；recovery 模块负责格式、系统加密、独占领取和用户意图编排。HTTP/MCP 只传记录 ID、当前会话 ID、核对选择；页面不能上传可信检查点。UI 负责中文计划/已执行项目展示、核对及重新授权。依赖为 UI/MCP → RecoveryService → TaskRuntime/RecoveryStore → 原有网关或加密/文件系统；存储不得调用 SSH。

检查点包含真实用户、固定主机/SSH 公钥、模式、计划快照、步骤位置、执行结果和必要的恢复说明。不保存可复用的控制租约、旧批准或本地文件授权，也不读取连接/模型配置中的密码和密钥字段。历史动作可能保留已经失效的能力 ID；命令参数本身按敏感数据加密，不能保证自动识别用户写进命令的全部秘密。系统加密不可用时拒绝持久化，不回退明文。

保存先收回自动控制权，在已派发动作收敛后保存；尚未明确的结果必须由人工决定核对后的恢复位置。恢复创建新的等待授权任务，核验新会话的用户、主机身份和公钥，不能重跑之前已经完成的步骤。MCP 只能领取属于同一客户端和允许主机范围的记录，领取不能批准执行。重新执行仍经过现有黑白名单、当前策略、预算与控制 epoch。

文件槽位重新选择；部分传输与目录游标不得直接伪装为未执行，本阶段在资源检查点未接入前明确拒绝该状态的保存或恢复。内置 AI 对话、模型预算与父流程的恢复需与运行协调器一起接入，不能把单独重建任务称为已经恢复整个 AI。

## 验收与验证命令

命令流程执行首步后保存，重启恢复不执行旧首步；恢复前没有 remote.write；再次授权按原模式运行。协作模式逐项批准、自动模式在新范围内连续执行，两者接管仍能停止旧请求。用户/主机/公钥不一致、损坏记录、并发领取和未知结果未核对必须拒绝。文件绑定不能复用旧能力；MCP 领取不绕过人工授权。

使用 app 的 tsc、改动模块 eslint、vitest（collaboration/recovery、文件、AI、MCP 和中文界面）、前后端构建及隔离 Windows 桌面证据。失败保留现场、复现和实际副作用后修复复测。以下记录本轮实际实现及验证边界。


## 已实现入口与恢复行为

任务面板底部提供“暂停并保存任务进度”和“查看可恢复任务”。保存会收回原任务的自动执行权，最多等待在途动作收敛 10 秒，成功落盘后停止原任务；加密或磁盘失败保留暂停任务。当前独立流程和 MCP 任务可使用，内置 AI 及仍在执行的父流程要求专用协调器，不伪装成普通任务保存。

恢复窗口展示原计划、步骤位置、此前脱敏执行结果和目标身份。普通流程由人工核对后创建新的待授权任务；未知步骤须明确选择核对后的重试或跳过。恢复不写 SSH，重新授权仍验证当前策略、Shell、范围、预算、控制 epoch 和本地文件槽位。恢复事务未完成持久化和领取之前，新任务不能提前授权；失败会停止中间任务，旧检查点可以再次领取。

已恢复任务会在每次派发前保存保守的在途状态，结果明确后更新步骤位置；保存失败会阻止该次派发。新任务首次需要显式保存。已经完成的步骤不会再次执行，跳过异常步骤保留 hasFailures 和核对记录。历史只保留在恢复详情与运行时内部，不塞入每次任务摘要刷新。

HTTP 入口都位于既有可信人工登录路由下：GET /tandem/recovery、GET /tandem/recovery/:id、POST /tandem/recovery/:taskId/save、POST /tandem/recovery/:id/restore、DELETE /tandem/recovery/:id。恢复请求只接收新 sessionId、reviewed=true 和可选 reconciliation，不接受外部检查点、旧批准或能力对象。

MCP 新增四项中文工具，当前共 **38 项**：list_saved_tasks、get_saved_task、save_task_progress、restore_task_progress。列表/详情只包含原客户端和允许主机的记录；领取后依然等待桌面授权。MCP 恢复 schema 不接受 reconciliation、origin 或人工身份；未知结果在桌面授权表单核对后才能继续。

## 存储与模块

- types/task-recovery.ts 与 recovery/schema.ts 定义版本 1 检查点及记录格式，计划仍用既有 validateTaskPlan 验证。
- recovery/store.ts 拥有按用户隔离的加密文件、独占写入/领取、进程中断判断和容量限制。复用 privacy 的 SystemRecordKey 和 AEAD 编解码，使用独立系统密钥命名空间和 TTR1 格式；不新增通用共享抽象。计划最多 100 步、历史最多 5000 项，快照最多 8 MiB；读取单记录上限 16 MiB，每用户最多 128 条、总计 64 MiB。
- recovery/service.ts 协调保存、审阅、恢复、去重领取和失败回收；store-production/production 负责实际依赖组装。TaskRuntime 只通过公开快照/恢复与持久化端口调用存储。
- TaskSession 使用现有 acceptedHostKeyFor 的实际已接受公钥。恢复同时核对用户、主机 ID、身份字符串与 SSH 公钥，未取得公钥的连接不能保存。
- TaskRecovery.tsx 与 task-recovery-api.ts 负责中文入口和 HTTP 适配；切换会话后迟到的恢复结果不能选中另一会话的任务，保存失败的提示不会藏在关闭的弹窗里。

## 验证证据与失败记录

完整相关回归 **114 文件 / 749 项通过，无跳过项**，包括文件、自动/协作、AI、流程、MCP 和原生终端。最后补充恢复事务落盘前禁止授权的并发场景后，任务恢复/任务运行时/MCP/中文界面组合 **4 文件 / 47 项通过**。类型、模块 lint、构建、翻译字面键检查通过；缺失键 0。打包 MCP 与隔离 Codex **3 项通过**，实际发现全部 38 项工具；Windows 包原生探针验证 13 项依赖。

真实 Windows 桌面完成自动和协作两种独立命令流程的跨正常重启恢复：第一步用共享 SSH 创建标记文件，在第二步前保存；正常退出重启并重新连接，恢复为待授权状态，首个文件时间戳不变且第二个文件尚不存在。重新授权后，自动模式执行剩余步骤；协作模式再次逐项批准才执行。最终第二个文件内容正确，原完成步骤未重跑，应用正常退出。证据目录 .cache/desktop-observation-report-93aba7d6-7133-481e-b530-bd2877736352。实际配置目录中的 4 份检查点具有 TTR1 加密头，未包含测试任务名、命令和路径的 UTF-8/UTF-16 明文标记；见 .cache/task-recovery-desktop-encryption.json。

首次桌面脚本创建主机后遗漏列表刷新，连接请求等待而超时；补齐脚本刷新后双模式完整通过。后续补录界面完成状态时复现已有 ConPTY/Bash 首字母丢失：SSH 输入日志是完整 if，终端显示 f，程序按 SHELL_CONTEXT_TIMEOUT 正确暂停，未发业务命令；不把它改写成恢复成功，也不修改输入或跳过探测。全量回归也曾出现一次真实终端等待完成超时，带原始帧记录单测复验通过，最终完整回归通过；这不证明既有 Windows 兼容问题已被修复，见第 32 份文档。

测试夹具最初错误假设自动模式的匹配命令必定待审批，现按操作完成事件收回控制，再验证恢复位置。MCP 清单与 Codex 探针从 34 更新为 38，并显式检查四个新增工具；没有删除工具发现检查。UI 错误测试改为真实 HTTP 错误结构。失败日志均保留。

主要日志：task-recovery-tests-first/second/third.log、task-recovery-tests-final-core.log、task-recovery-ui-tests.log、task-recovery-regression-final.log（含一次终端超时）、task-recovery-pty-traced-recheck.log、task-recovery-regression-verified.log（749 项）、task-recovery-final-race-verified.log、task-recovery-packaged-mcp-final.log、task-recovery-native-probe.log、task-execution-recovery-desktop-first/second/final.log，均位于 .cache。

## 尚未完成

后续已接入独立内置 AI 的对话、模型轮次/预算和问题恢复，见 [第 44 份文档](44-ai-task-recovery.md)。父流程关系和命令步骤已在 [第 45 份文档](45-parent-workflow-recovery.md) 接入持久化恢复；目录内部逐项游标、未完成传输的资源检查点尚未与任务恢复合并。当前会明确拒绝这些未支持状态。文件流程可保存逻辑步骤边界并要求新文件绑定，但未取得全部文件/目录跨重启桌面组合证据。恢复详情的大历史分页和更广的损坏/并发关闭/磁盘故障矩阵仍需补齐。

实际跨版本在线升级、完整认证/跳板、监控/隧道权限、备份及全量 F01–F15/B01–B16/R01–R11/A01–A37 继续。完整 Goal 未完成；本轮没有把独立任务恢复替代全部 AI/流程恢复。


## 最终包与完整 CI 顺序复核

最终含恢复事务授权门禁的 Windows 包已通过双模式重启验证，且截图等待实际任务面板显示“已完成 / 2 / 2 步”：.cache/desktop-observation-report-6d033345-0cf6-40e3-9997-52473331e9e0。实际共享 SSH、首个文件不重写、第二文件内容、重新授权和协作逐条批准均通过；首末正常退出。最终原生探针和打包 MCP/隔离 Codex 3 项通过，类型与模块 lint 通过。日志 task-execution-recovery-desktop-release.log、task-recovery-release-mcp.log、task-recovery-race-types.log、task-recovery-race-lint.log、task-recovery-package-final.log。

上一提交 dc27429 的云端 CI 34329364523 在终端测试文件内失败 4 项，其他 455 文件通过，未生成新安装包。CI 与 Release 现在先运行应用测试，再单独运行真实交互 PTY 测试，减少终端与数百测试进程争用；两组必须通过，不重试、不删除断言、不关闭 Spectre。已用相同顺序和长路径/原始帧设置在本机验证：应用组 **457 文件 / 3279 项通过，4 项按既有条件跳过**；真实终端组 **1 文件 / 10 项通过**。日志 task-recovery-ci-application-tests.log 和 task-recovery-ci-terminal-tests.log。4 项跳过不计为已验证，原生终端兼容风险仍按第 32 份文档保留；本机通过不能提前代替新提交云端结果。

后续 AI 接入时补充了自动检查点的父流程标记：activeWorkflowRunId 存在时 resourceRecoveryRequired 为真，恢复入口拒绝将子流程直接作为整个根任务继续。独立任务既有恢复行为保持不变。

上述父流程待恢复标记是第 44 阶段的保护措施。第 45 阶段已用完整父流程快照替代新记录中的笼统标记；旧记录缺少关系时仍拒绝猜测恢复。恢复后的父任务完成时持久化 completed，列表区分“已完成”与“已被新任务接续”，已完成记录不能重新恢复。

后续上传目录的完整条目边界已接入任务恢复，并通过真实 Windows 自动/协作重启验证；下载目录及部分传输资源仍需继续，见 [第 47 份文档](47-task-directory-recovery.md)。

下载目录的完整条目边界后续也已接入任务恢复，并通过真实 Windows 自动/协作重启验证；部分文件与独立目录协调器仍需继续，见 [第 48 份文档](48-task-download-directory-recovery.md)。
