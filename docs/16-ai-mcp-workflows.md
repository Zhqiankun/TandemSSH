# 内置 AI 与 MCP 调用保存流程

更新日期：2026-09-07。已实现保存流程的查找、参数读取、预览、独立任务启动和父任务内执行。文件步骤及完整产品验收仍在进行。

## 两种执行方式

- 独立流程：preview_workflow 不传 parentTaskId，随后 start_workflow 建立一个待桌面授权的任务。返回的 id 是 taskId，用 get_task 查看进度。
- 父任务内流程：先有 start_task / 内置 AI 任务；preview_workflow 绑定 parentTaskId，随后 run_workflow 使用同一个任务、会话、控制租约、目录范围和剩余操作预算。返回的流程 id 用于 get_workflow_run。

父任务内的流程完成后，控制权仍由父任务持有；父任务结束或人工接管才会归还。流程活跃期间不能插入流程外命令，也不能同时启动第二个流程。模型必须读取流程结果后重新决定后续操作，不能把同一模型响应中提前生成的后续命令直接接着执行。

~~~mermaid
sequenceDiagram
    participant AI as AI / MCP
    participant Lib as 流程库
    participant Task as 父任务
    participant UI as 人工界面
    participant Gate as 动作网关
    participant PTY as 共享终端
    AI->>Lib: 查找、读取参数、预览
    AI->>Lib: run_workflow（父任务、预览）
    Lib->>Task: 安装不可变流程计划
    loop 按顺序执行每一步
        Task->>Gate: 提交步骤
        opt 协作模式或当前授权不足
            Gate-->>UI: 等待本步确认
            UI->>Gate: 人工批准
        end
        Gate->>PTY: 核对规则、范围和控制权后写入
        PTY-->>Task: 真实结果
    end
    Task-->>AI: 流程结束，父任务仍持有原控制权
    AI->>Task: 读取结果后决定后续动作
~~~

## 新增的 MCP 工具

当前共 18 个工具，新增以下 6 个。没有新增人工批准、授权签名或任意原始终端写入工具。

| 工具 | 输入与用途 |
| --- | --- |
| list_workflows | hostId、可选 offset；分页读取该主机可用的流程概要 |
| get_workflow | hostId、workflowId；读取参数 schema 和步骤概要 |
| preview_workflow | workflowId、sessionId、parameters、可选 parentTaskId；固定参数结果、目标、策略和控制权版本 |
| start_workflow | previewId、requestId、mode；创建独立流程任务，等待桌面授权 |
| run_workflow | taskId、previewId、requestId；在已绑定的父任务中运行，不改变父任务模式或授予新权限 |
| get_workflow_run | taskId、workflowRunId；读取父任务中的流程进度与操作结果 |

名称、描述、脚本和终端输出均是数据，不是提高权限的指令。查找按允许访问的主机过滤；预览还绑定调用者身份，MCP 客户端之间、MCP 与内置 AI 之间不能交换预览使用。

get_task 返回 activeWorkflowRunId 和流程摘要。该字段存在时不能把父任务的中间 ready 状态理解为“允许发送其他命令”；应查看具体流程状态。结果为 unknown / paused 时先由人工核对，不能换一个 requestId 盲目重跑。

## 内置 AI

执行阶段保留 run_command、ask_user、finish_task，并增加 list_workflows、get_workflow、preview_workflow、run_workflow、get_workflow_run，共 8 个模型工具。主机、会话与父任务由核心注入，模型不能自行指定其他目标或冒充人工。初始规划阶段仍不提供执行工具。

例如输入“使用流程库里的发布检查，message 填写本次版本说明，检查结果后报告”。模型可查找模板、读取参数、生成预览并请求执行；已有授权覆盖的步骤自动推进，协作模式仍逐条确认。模板保存和修改只通过人工界面，模型没有保存模板的工具。

等待流程或人工确认期间不会重复请求模型，也不反复复制整个流程的输出。接管后保留原流程和原始结果；重新授权后从明确的恢复位置继续，模型先读取旧流程的结果，再决定下一步。

## 授权与数据约束

- 附加流程不重置父任务的预算或有效期，不扩大程序或目录范围。未被既有范围覆盖的动作仍需人工批准。
- 人工重新授权时，界面展示当前计划并提交 planRevision。旧界面、旧计划的批准不能授权后来附加的新流程。
- “已审阅脚本”绑定具体计划。新附加的脚本不能借用父任务之前的审阅状态；严格白名单和拒绝规则仍然优先。
- 预览中已明确拒绝的计划在启动前被拒绝。主机分组/标签变化会使旧预览和任务授权失效；授权探测和命令写入前都会核对。
- 流程定义和已执行快照分开；重复同一个逻辑请求返回同一流程，改变参数或父任务需要新预览。
- 失败继续不会变成全绿成功；人工跳过未知结果也保留原结果。父任务最终可显示 completed-with-errors，内置 AI 的官方状态同样保留失败提示。
- 每个父任务最多保留 32 个流程运行、64 个流程幂等请求；展开后的流程最多 512000 字节。流程结果面向模型的输出片段总计最多 12000 字符，每步最多 4000，并标明截断。
- secret-ref 的安全传输仍未实现，继续明确拒绝该用途，不降级为明文参数。

## 实现责任

| 文件 / 模块 | 职责 |
| --- | --- |
| collaboration/tasks/runtime.ts | 复用顺序执行器，在父任务中安装和完成流程计划；独占、预算、控制权、计划版本与运行摘要 |
| collaboration/workflows/library.ts | 面向自动化的主机目录、详情、预览、预检查与结果投影 |
| mcp/contracts、core、server、production | 严格输入契约、可信身份注入、工具注册和生产接线 |
| ai/tasks/workflow-tools.ts、runner.ts | 模型工具 schema、流程等待、接管后的结果核对与下一轮决策 |
| types/collaboration-task.ts | 前后端共用的计划版本和流程运行摘要 |
| ui/features/collaboration/WorkflowRuns.tsx | 中文流程来源、版本、进度和结果提示 |
| scripts/verify-codex-mcp.cjs | 开发验证：仅通过临时配置启动本项目 stdio，拒绝初始化无关 MCP，不修改全局配置或创建 Codex 任务 |

## 验证证据

- 共享运行核心覆盖预算继承、同一控制租约、两个流程的幂等隔离、禁止插入命令、旧计划批准失效、旧脚本批准失效、接管与未知结果恢复、失败继续、审计竞态、主机范围变化和输出上限。
- 内置 AI 循环覆盖查找/详情/预览/执行/结果读取；协作等待不请求模型，接管后不重复启动流程，失败不会变成官方成功状态。
- 标准 MCP SDK 通过真实 Git Bash PTY 验证自动与协作两种模式。流程设置的变量被流程结束后的父任务命令读到；控制租约在流程前后相同。独立流程启动同样实际执行成功。
- 打包后的 TandemSSH.exe 以 stdio 模式，通过 Windows 系统凭据和签名本机管道执行保存流程，验证输出脱敏与断开后撤销。
- 本机 Codex app-server 在同一个有效测试配对存续期间，通过临时配置发现全部 18 个中文工具；没有创建 Codex 任务、调用模型或改全局配置。runtimeStatus 的全局值为 null，不将其冒充任务内连接状态。

完整打包回归 **40 文件 / 298 项通过**：.cache/parent-workflow-packaged-regression.log。Codex 目录证据 .cache/codex-workflow-integration.json。类型、前后端构建和 Windows 解包包通过，日志 .cache/parent-workflow-final-ui-types.log、.cache/parent-workflow-final-build.log、.cache/parent-workflow-package.log。新增/修改模块 lint 无错误或警告，静态翻译缺键为 0。

验证包仍采用 npmRebuild=false；标准 Spectre 原生重编译问题没有因此解决。MCP 的流程调用使用真实 SDK/stdio 与真实 PTY，内置 AI 的新流程循环使用确定性模型夹具；不能把这些结果说成真实云模型、Linux SSH/SFTP 矩阵或全产品验收已完成。

开发者可在 app 目录运行对应 Vitest 测试。设置 TANDEM_TEST_MCP_EXECUTABLE / TANDEM_TEST_MCP_ENTRY 可改用刚打包的入口；设置 TANDEM_TEST_CODEX 为本机 Codex CLI 的绝对路径，可额外执行目录发现验证。测试配对和临时配置在结束时清理。


测试路径已固定到仓库，不依赖调用目录。随后从仓库根目录完成相关回归 2 文件 / 8 项通过，日志 .cache/parent-workflow-path-regression.log；测试临时文件与清理范围也固定在本项目 .cache 下。


## 保存流程文件步骤的后续实现

文件与命令混合步骤现已接入保存流程、中文授权及 AI/MCP 父任务；运行期本地文件绑定不进入模板导出。格式版本、使用方式、验证证据与剩余边界见[保存流程中的文件步骤](31-workflow-files.md)。此前“文件步骤尚未接入”的段落为历史状态；自动目录批次和跨重启恢复仍未完成。
