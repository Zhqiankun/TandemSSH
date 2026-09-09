# MCP 接入与验证

更新日期：2026-09-09。当前已实现本机 MCP 会话、命令、任务、保存流程、文件/目录双向传输及独立任务恢复，共 38 项中文工具。独立内置 AI 对话恢复已接入桌面；AI/MCP 父任务中的命令流程已支持跨重启恢复，部分传输和目录内部游标仍在实施；完整产品尚未交付。

## 使用方式

1. 启动同舟 SSH 桌面，保存要使用的 SSH 主机。
2. 打开“用户资料 → MCP 接入”，或终端协作面板底部的“MCP 接入”。
3. 输入客户端名称，选择允许访问的主机，然后创建配对。“允许读取已有终端内容”默认关闭；已授权命令自身的结果仍会返回客户端。
4. 复制界面生成的 Codex 配置，加入 Codex 的 MCP 设置。路径、profileId 和 clientId 以当前界面生成为准；不要使用测试目录或别人的标识。
5. 保持同舟 SSH 桌面运行。Codex 先查询服务器/会话，再创建任务；桌面确认本次目录、程序、数量和有效期后才能执行。
6. 上传/下载前，在任务面板选择本地来源或目标并设置覆盖权限；Codex 用 list_authorized_files 获取 ID/版本，再调用 upload_file / download_file。不要向工具传本地路径。

配置使用本地 stdio，启动同舟可执行程序中的 MCP 入口，并设置 ELECTRON_RUN_AS_NODE=1。它只含程序路径和配对引用，不含 SSH 密码、模型 API Key 或配对秘密。配对秘密存放在当前 OS 用户的系统凭据库。

Codex 的原生命令也支持 `codex mcp add`；当前界面提供可复制配置。本轮验证使用临时命令行配置，没有写入用户日常 Codex 设置。

## 当前工具

| 工具 | 行为 |
| --- | --- |
| get_status | 当前客户端身份、主机范围和能力 |
| list_hosts | 只列出配对授权的主机元数据 |
| list_sessions | 授权主机的实际 SSH 会话与控制状态 |
| open_session | 请求桌面打开终端；复用现有主机指纹与认证流程 |
| read_terminal | 经允许后读取脱敏终端窗口；返回 replace=true 的快照、游标和缺口信息，不应重复拼接 |
| start_task | 请求协作或自动任务，初始等待桌面授权 |
| get_task | 读取任务、控制权与操作摘要 |
| run_command | 向已授权任务提交程序、参数和目录 |
| get_operation | 读取单个操作的状态、退出码和有界脱敏输出 |
| wait_operation | 等待具体操作进展，审批等待不代表执行成功 |
| finish_task | 在结果明确后结束任务并归还控制权 |
| cancel_task | 停止后续派发；不会撤回已发出的命令 |
| list_workflows / get_workflow | 查找允许主机的流程并读取参数定义 |
| preview_workflow | 预览保存流程，可绑定现有父任务 |
| start_workflow | 创建待人工授权的独立流程任务 |
| run_workflow / get_workflow_run | 沿用父任务租约执行流程并读取结果 |
| list_directory / stat_file | 在文件授权范围内查询目录页和文件属性；目录子项拒绝规则继续生效 |
| read_file / get_file_content | 请求读取文件，再按版本分页读取脱敏正文 |
| propose_file_edit / propose_file_write | 提议精确修改或完整保存；版本、范围与人工审阅继续校验 |
| list_authorized_files | 查询本任务已选来源/目标的 ID、版本、名称和状态，不返回本地绝对路径 |
| upload_file / download_file | 使用已授权能力执行文件上传/下载，共用任务范围、审批与接管 |
| get_transfer_status / release_transfer | 查询进度/校验结果，或释放无待核实/待清理事项的结束进度记录；不删除文件 |
| preview_directory_transfer / get_directory_transfer | 预览目录传输、分页核对来源与目标清单 |
| run_directory_transfer / get_directory_run / release_directory_transfer | 在任务授权内执行批次、查询逐项结果与释放结束记录 |
| list_saved_tasks / get_saved_task | 查询原客户端及允许主机范围内的执行检查点与此前结果 |
| save_task_progress | 暂停并保存独立任务执行位置，成功后停止原任务 |
| restore_task_progress | 绑定同一服务器的新会话，创建待桌面重新授权的任务，不批准执行 |

工具没有人工批准、授予控制权或任意原始输入接口。命中拒绝规则不能由 MCP 自行绕过。协作模式逐条确认，自动模式仅覆盖本次明确授权；脚本和解释器不会因为宽泛的程序范围自动获得批准。

命令按顺序提交。前一条尚未结束时，其他命令返回 OPERATION_IN_PROGRESS；重复同一动作使用相同 requestId，改变动作必须用新 ID。明确取消后要重新创建任务，应使用新的任务 requestId；重连不会恢复旧任务授权。

人工直接在终端输入也会先收回控制权。交还时需要重新确认 Shell 已处于提示符。本次目录范围约束命令的执行目录，不是远端文件访问沙箱；远端账号权限与专门的文件动作规则仍然重要。

## 模块边界

`contracts.ts` 定义 SDK 与核心共用的严格输入 schema。stdio 只做协议适配，经带新鲜挑战、方向和序号的签名本机通道访问桌面核心；可信核心注入客户端身份，不接受客户端声明自己是人工。

`pairing-registry.ts` 管理用户/主机范围与撤销；`credential-store.ts` 只访问 OS 凭据库。`core.ts` 调用共享 TaskRuntime，使用明确字段投影和脱敏，不返回完整凭据记录。`session-requests.ts` 将连接请求交给 AppShell 的既有 openTab 入口，通过 instanceId 关联真实会话。

连接丢失或配对撤销会同步撤掉该连接的自动控制权。撤销后的持久元数据或已删除的系统凭据都能阻止后续认证；不会降级为明文秘密。

## 验证结果与限制

以下保留早期命令接线证据。当前 24 项工具、打包 stdio/SFTP 和 Codex 实测见[目录与文件属性查询](21-file-inspection.md)；文件正文与审阅见[文件工具说明](19-ai-mcp-files.md)。

- 标准 SDK 的真实 stdio 子进程通过 Windows 系统凭据和实际本机管道连接共享任务核心，验证了授权等待、受控命令、脱敏输出、权限和断开处理。
- 打包后的桌面在独立配置中，通过回环 SSH 连接临时 Git Bash 服务。MCP 自动模式完成 pwd/printf；协作模式逐条批准后运行命令。人工输入收回控制权，期间 MCP 写入被拒绝；重新授权后 printenv 读出人工设置的“人工接管成功”。
- 本机 Codex app-server 使用临时配置成功初始化同舟服务器并发现 **12 个中文工具**，证据 .cache/codex-mcp-integration.json。未创建 Codex 任务或调用模型；全局状态查询的 runtimeStatus 为 null，serverInfo 与工具目录已实际返回。
- 实际 SSH 操作证据 .cache/mcp-live-evidence.json；桌面撤销证据 .cache/mcp-revocation-evidence.json。测试配对的系统凭据已确认删除，测试进程和端口已退出。
- 初轮 MCP 接线回归 **22 文件 / 153 项通过**，见 .cache/mcp-full-regression.log；完整类型检查、前后端构建通过，静态翻译调用缺键为 0。

已遇到并记录的失败：测试最初未及时确认主机密钥而超时；printf 参数误带实际控制字符被发送前拒绝；另一次测试重用了已取消任务的 ID，正确返回了旧结果。修正测试参数和逻辑任务 ID 后重新完成整条流程，未重放结果未知的操作。

当前终端适配器要求可控制的 POSIX Shell，并拒绝直接写入参数中的终端控制字符；复杂交互程序、完整脚本格式、MCP 外部任务未知结果的进一步核对/重试关联仍需继续补齐。命令包装代码仍会在终端中大量回显，主机指纹格式与部分上游页面汉化也仍待修复。以上不构成 Linux 服务器矩阵、SFTP 或整个产品已验收的证明。

保存流程工具现已扩展为共 18 个工具；父任务、独立流程、Codex 发现和新的打包回归证据见[AI/MCP 流程说明](16-ai-mcp-workflows.md)。早期 12 工具记录保留为历史证据。

## 独立任务恢复

保存与领取使用同一客户端配对；原检查点只领取一次，恢复任务使用新 ID 并要求新授权。未知结果必须在桌面核对，MCP 不能传 reconciliation 或人工身份。原步骤结果和继续位置见 [任务执行恢复](43-task-execution-recovery.md)。内置 AI 对话、问题和预算已由桌面恢复服务接入，见 [内置 AI 恢复](44-ai-task-recovery.md)；MCP 不领取该 AI 身份。AI/MCP 父任务中的命令流程已接入恢复：保留原运行 ID、版本、步骤和结果，重新授权后执行剩余步骤，再回到父任务。get_workflow_run 可以查询恢复前后的结果，旧操作 ID 不能重新批准或派发；完成父任务后检查点显示“已完成”。详见 [父任务流程恢复](45-parent-workflow-recovery.md)。部分传输与目录内部进度仍需继续接入。
