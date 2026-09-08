# AI / MCP 目录与文件属性查询

更新于 2026-09-08。本轮新增 list_directory、stat_file，MCP 共 24 项工具；内置 AI 的文件工具增至 6 项，连同命令、问答、结束任务和保存流程共 14 项。完整首版仍按 F01—F15、B01—B16 继续实施。

## 可用行为

| 工具 | 输入 | 结果与执行语义 |
| --- | --- | --- |
| list_directory | path，可选 cursor、pageSize | 创建 file.list 操作；等待成功后返回目录页、快照时间、下一页游标和省略数量 |
| stat_file | path，可选 followLinks | 创建 file.stat 操作；返回类型、大小、Unix mode、UID/GID、时间和实际检查路径 |

先创建任务，在桌面授权目录读取范围，再提交查询。协同模式逐项确认，自动模式沿用本任务授权；两者均消耗操作预算、复用共享队列并响应接管。查询不会写入终端，也不获取文件正文。

MCP 调用顺序为 start_task → 桌面授权 → list_directory → wait_operation/get_operation → 根据 nextCursor 请求下一页或对所选路径 stat_file。每次新操作使用新 requestId；重试同一提交沿用原 requestId。get_task 只返回 directorySummary，完整页面通过操作 ID 读取，避免任务概览不断复制目录内容。

内置 AI 等待目录或属性操作的实际结果后才发起下一次模型决策。模型在同一响应中提前生成的后续调用会标记未执行；目录名、文件名和文件正文均是不可信数据。

中文任务面板展示实际路径、查询时间、文件类型、大小、权限、所有者及分页提示。名称作为文本渲染，不作为 HTML 或 shell 命令解释。当前展示操作已经获取的页面；完整工作台的目录选择、传输预览和文件流程步骤继续补齐。

## 权限与链接

目录查询需要 kind=directory 且包含 read 的任务范围，精确 path 授权不会隐式扩展成整个目录。write 也不隐含 read。目录的请求路径与解析后路径均需通过权限和拒绝规则。

列表里的每个直接子项分别检查路径范围与拒绝规则，被拒绝项不进入响应和操作结果。只允许枚举当前目录的直接子项，不通过此检查接口探测其他路径。省略项只汇总数量，不返回被隐藏名称；不宣称这一计数提供存在性保密。

目录路径本身会解析并检查实际目标。列出的子项不会递归，也不会跟随子项的符号链接。stat_file 默认保留最后一级符号链接，能够显示链接自身的属性；其父目录仍需解析。明确传 followLinks=true 才查询最终目标属性，且在读取目标属性前检查目标范围。

分页快照绑定用户、任务、会话、generation、controlEpoch、实际 SSH 连接标识与目标身份。接管、重连或跨任务不能继续使用旧游标；每页仍重新检查当次权限和规则。分页不续期，不恢复旧授权。

## 文件责任与依赖方向

| 位置（相对 app/src） | 责任 |
| --- | --- |
| types/file-inspection.ts、types/file-operations.ts | 查询动作、目录页和属性 DTO；不含正文和凭据 |
| backend/files/ports.ts、sftp-io.ts | 已认证 SFTP 上的目录句柄、分批读取、类型属性映射、EOF/取消/限额及关闭 |
| backend/files/inspection.ts | 查询用例、链接语义、目录快照缓存、分页、稳定顺序与连接绑定 |
| backend/files/automated-documents.ts | 组合已有动作生命周期与查询用例，结束时释放独立 SFTP 通道 |
| backend/collaboration/operations/gateway.ts | 统一任务授权、预算、单队列、接管和当前目录子项权限检查 |
| backend/collaboration/policies/file-policy.ts | file.list/file.stat 的严格 schema、只读范围和拒绝优先 |
| backend/collaboration/operations/file-result.ts | 结果字段白名单、路径来源、分页计数、重复名称和响应容量验证 |
| backend/collaboration/files/automation.ts | FileAutomation 的查询入口，只向 TaskRuntime 提交动作 |
| backend/mcp/contracts.ts、core.ts、server.ts | MCP 输入、中文工具、结果与摘要投影，不授予人工权限 |
| backend/ai/tasks/file-tools.ts、runner.ts | 模型工具 schema、等待操作及按实际结果继续决策 |
| ui/features/collaboration/FileInspectionResult.tsx、TaskPanel.tsx | 中文结果呈现，不执行 I/O 或修改权限 |

依赖方向是 MCP/AI → FileAutomation → TaskRuntime/网关 → 文件查询用例 → SFTP 端口。文件查询用例通过网关注入的检查接口判断子项，不能自行签发授权；后端不依赖界面文件。FileTaskContext 仅作类型引用，不形成运行时循环。没有新增泛化 shared/utils 抽象；主智能体负责这些模块和集成验证。

## 有界快照与失败

- 每页默认 50 项，上限 100 项，并对条目序列化容量限制为约 32 KB；完整查询结果校验上限 64 KB。
- 单次目录枚举最多 10000 项、约 2 MB，超限报错并关闭句柄，不把部分列表伪装为完整结果。
- 快照存活 5 分钟，最多 64 份；序列化条目容量按单份 2 MB、单用户 4 MB、全局 8 MB 限制。这不是进程 RSS 上限承诺。
- 分页基于同一有时间戳的缓存快照，后续文件变化需要重新查询。读取前后检查目录属性，但 SFTP 不提供此处所需的原子目录快照保证；属性相同不能证明期间完全没有外部变化。
- 拒绝子项和不能表示为当前受控路径的名称计入 omitted；不跟随链接、不返回私有正文。重复子项或无效元数据导致明确失败。
- EOF 是正常结束；当前 ssh2 对句柄 READDIR 的 EOF 使用状态码 1，经适配后正确结束。最多容忍有限数量的空批次，避免异常服务器造成无限读取。

关键错误包括 FILE_NOT_DIRECTORY、FILE_DIRECTORY_TOO_LARGE、FILE_DIRECTORY_CHANGED、FILE_DIRECTORY_CURSOR_EXPIRED、FILE_DIRECTORY_CACHE_FULL、FILE_SCOPE_EXCEEDED 和 STALE_CONTROL。失败不自动扩权，不创建另一个 SSH 登录，也不自动执行 ls/stat 脚本。

## 验证与边界

最终 Windows 验证包联合回归 **75 文件 / 619 项通过**，见 .cache/file-inspection-packaged-regression.log。真实本机 SFTP 验证多个 READDIR 数据包、空目录、中文/空格/百分号名称、类型识别、取消/限额后的句柄关闭。生产文件工具测试通过打包可执行程序的 stdio、系统凭据和签名本机通道，在自动/协同模式实际执行目录、属性与文件修改，SSH 认证连接数均为 1。

确定性模型测试验证内置 AI 的“目录 → 属性 → 读取 → 修改”链路和后续调用延迟决策；没有调用付费模型。真实 Codex app-server 已发现 24 项中文工具（.cache/codex-mcp-integration.json），使用临时配置，不修改用户日常 Codex 设置。

中文组件测试覆盖目录分页、类型/权限、省略项提示及将 HTML 形状文件名作为文本。更新后的桌面包在独立数据目录启动成功，实际标题与 lang 分别为“同舟 SSH · TandemSSH”和 zh-CN，数据库显示运行正常（.cache/file-inspection-desktop-evidence.json）。首次截图早于页面加载，核对同一进程后重新读取成功，没有重启掩盖问题；应用随后正常退出，监听端口已释放。

本轮类型、相关模块 lint、前后端构建及 Windows 解包包通过。标准原生重编译的 Spectre 库前置条件仍未解决，验证包继续使用 npmRebuild=false。本轮真实服务是本机 SSH/SFTP 夹具，不能代替 Linux/OpenSSH 权限与断网矩阵，也不是全套文件工作台桌面验收。上传下载、跨目录保存/目标预览、文件流程步骤、历史/草稿和凭据保护等剩余要求继续保留。
