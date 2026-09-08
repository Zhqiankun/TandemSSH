# 旧快捷命令与宏接入协作任务

更新于 2026-09-08。本轮将上游快捷命令和顺序宏接入既有任务授权、共享终端、规则与记录。完整产品仍在实施；本文不代表全部基础功能和发行门槛已验收。

## 用户行为

执行快捷命令时先填写参数，再选择自动或协同模式。创建后显示“待授权”，对应终端打开协作面板，供人工核对目标、命令和授权范围。自动模式按本任务授权继续，协同模式逐条确认；两者均可接管，命中拒绝规则不能执行。

侧栏、命令面板、主机快捷操作和旧的 `/snippets/execute` 入口使用相同规则。必须已有当前用户拥有的 SSH 终端；按主机执行时若有多个可选会话，要求用户进入目标终端选择，不擅自选择一条或另建 SSH 连接。共享访客身份与 API Key 不能使用人工入口授予权限。

宏中的连续输入片段在回车处编译为完整命令。顺序执行等待每条命令真实结束，延时成为可见的 `sleep` 动作，有限次数重复展开为受控步骤。接管后不再派发后续步骤；正在运行的程序是否已经产生副作用，以操作结果为准。

笔记仍使用人工粘贴。包含换行的笔记需要查看并确认；笔记不被当作执行完成的任务，也不能通过后端执行接口运行。

## 兼容与迁移边界

| 原有内容 | 当前处理 |
| --- | --- |
| 简单命令、按行顺序命令、引号内参数 | 编译为程序和参数数组，创建待授权任务 |
| HOST / USER / PORT / NAME / INPUT_n 参数 | 先解析命令结构，再插入参数值；主机事实由后端读取 |
| 顺序宏、延时、有限重复 | 编译为至多 100 条完整命令，全部检查通过后才创建任务 |
| 动态程序名、隐式 shell 展开、管道或重定向 | 明确提示需要迁移，不悄悄包装成受信任脚本 |
| 等待屏幕文本、条件分支、未完成的交互输入 | 整个宏拒绝创建，保留原配置，不先执行一部分 |
| 需要脚本的顺序流程 | 使用现有流程库中显式解释器命令和脚本审阅，继续受规则与任务授权限制 |
| 上游定时、Webhook、监控触发与多服务器后台自动化 | 保留配置与编辑，当前执行入口关闭，界面提示迁移；不计为已交付的新后台调度能力 |

复杂交互宏和后台调度与已承诺的首版顺序流程区分开来。上传下载、在线编辑、文件流程步骤等原定功能继续实现，不因本轮迁移限制而缩小范围。

## 模块责任与依赖

| 文件/目录（相对 app/src） | 责任与约束 |
| --- | --- |
| types/legacy-commands.ts | 旧定义与任务创建请求类型，不包含凭据或传输能力 |
| domain/commands/parse-plan.ts | 前后端共用的有限命令语法；纯解析，不连接服务器 |
| domain/commands/legacy-policy.ts | 明确关闭旧副作用路径；没有环境变量或用户设置可启用 |
| backend/collaboration/legacy/compile.ts | 深度/大小限制、参数数据绑定、顺序宏编译；不执行命令 |
| backend/collaboration/legacy/service.ts | 检查目标与控制权前后是否一致，调用 TaskRuntime 创建待授权任务 |
| backend/collaboration/legacy/production.ts | 组合已有会话、主机仓储与通知；仅提供该用户拥有的活动 SSH 会话 |
| backend/collaboration/http/routes.ts、backend/database/routes/snippets.ts | 人工身份、输入校验、状态码和响应；没有独立 SSH 执行器 |
| ui/api/legacy-commands-api.ts、ui/api/snippets-api.ts | HTTP 契约与错误码适配，不把创建任务显示成执行成功 |
| ui/features/collaboration/use-task-mode-choice.tsx | 选择模式或取消；不授权、不写终端 |
| ui/hooks/use-snippet-runner.tsx、各旧面板与 Terminal.tsx | 收集输入、请求任务、展示状态、打开任务面板 |
| backend/automations、backend/database/routes/automations.ts | 旧执行路径在引擎、动作、调度、监控、HTTP 层关闭；配置仍可读写 |

依赖方向为页面 → API → 人工入口 → 迁移用例 → TaskRuntime → 既有动作网关 → 共享会话。后端不依赖页面文件；迁移用例不能直接向 SSH 写入或自行批准任务。命令解析归属命令领域，不另建泛化的 shared/utils 抽象。当前各模块由主智能体维护并验证。

## 接口与失败语义

`POST /tandem/legacy/tasks` 接受 `sessionId`、`requestId`、`mode` 和 `source`。source 为 snippet（标题、原始模板、输入值）或 macro（标题、步骤快照）。响应为 `task` 与迁移提示 `notes`，任务初始状态为 `awaiting-authorization`。

`POST /snippets/execute` 兼容旧调用方的 snippetId、hostId 和 inputValues，可选 sessionId、requestId、mode。返回 HTTP 202，包含 `status: awaiting-authorization`、taskId、sessionId。保留的 `success` 字段为 false，避免旧客户端误报执行成功。请求/笔记错误为 400，非人工入口为 403，不可访问的片段为 404，会话、范围和迁移冲突为 409。响应禁止缓存。

`SHARED_SESSION_REQUIRED` 表示没有唯一可用的共享会话；`LEGACY_SESSION_AMBIGUOUS` 表示需要选择目标会话；`HOST_SCOPE_CHANGED`、`STALE_SESSION` 等拒绝使用已经变化的目标。复杂命令与交互宏分别返回 `LEGACY_SHELL_MIGRATION_REQUIRED` 和 `LEGACY_INTERACTIVE_MIGRATION_REQUIRED`，不返回部分可执行计划。

旧自动化 run、dry-run 与 webhook 统一返回 HTTP 409 / `LEGACY_AUTOMATION_REQUIRES_MIGRATION`。引擎和动作层也独立防护，不能通过直接调用或后台触发绕过 HTTP。参考上游行为的单元测试仅在测试模块中显式模拟旧开关；另有未模拟开关的生产防护测试证明默认不会产生副作用。

## 参数、终端输出与结果验证

参数值不作为 shell 源码拼接。空格、引号、中文、换行及 `$&`、`$$` 保持字面值；拒绝把参数放在程序名位置。请求、递归结构、展开步数与参数容量均有限制。超过十个替换标记的情况单独测试，防止短标记错误替换长标记。

真实 Windows Git Bash PTY 测试发现 ConPTY 可能在开始帧之后转发上一条输入回显的末尾。解码器仅去掉已核实与发送行完全一致的延迟尾部及对应换行；不一致的内容保留。补充跨分块、真实首行空白和不同尾部用例。这修复任务输出被内部标记污染的问题；终端窗口仍可能显示较长的封装命令，后续继续改进显示。

验证环境全部为本机临时服务和测试目录。真实 PTY 验证自动/协同顺序执行、目录保留、参数字面值与接管阻止后续宏；HTTP 验证未授权响应、非人工拒绝和无额外 SSH 连接；配置回归保留旧定义读写。未使用真实服务器或收费模型。最终联合结果与日志见实施记录。
