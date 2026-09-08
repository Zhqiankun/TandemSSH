# 内置 AI / MCP 文件读取、修改与人工审阅

更新日期：2026-09-08。本轮将文件网关接入正式 SSH 会话、内置 AI 和 MCP。MCP 工具从 18 项扩展到 22 项；内置 AI 在已有命令和流程工具之外增加 4 个文件工具。完整首版仍按原始文档范围继续实施，不能把这一轮文件工具等同于全部工作台验收。

后续已增加目录与属性工具，MCP 当前为 24 项；本篇保留此前文件正文与修改设计，新增行为和最新验证见[目录与文件属性查询](21-file-inspection.md)。

## 1. 当前可用行为

| 工具 | 行为 | 约束 |
| --- | --- | --- |
| read_file | 请求读取任务范围内的远端文本文件，返回操作 ID | 必须先有桌面授权；协同模式等待逐项批准 |
| get_file_content | 按版本读取已取得快照的脱敏正文，支持分页 | 绑定用户、任务、会话与控制权；跨页使用 nextOffset |
| propose_file_edit | 对基线执行唯一匹配的 before/after 精确替换 | 保留其他内容，不能命中隐藏值或把脱敏占位写回 |
| propose_file_write | 用完整内容替换已读快照 | 需要已读取全部页面且未发生脱敏；空字符串可保存为空文件 |

MCP 调用顺序：start_task → 桌面确认文件范围 → read_file → wait_operation/get_operation → get_file_content → propose_file_edit 或 propose_file_write → 核对结果。保存后若需再次读取正文，应重新调用 read_file 获取新快照。

内置 AI 会等待文件操作结果，读取后的正文第一页随工具结果返回；后续页面使用 get_file_content。一次模型响应里排在文件操作之后的调用会标记未执行，待模型根据实际文件结果重新决定下一步，不自动沿用尚未看到结果时生成的后续命令。

## 2. 同一 SSH 连接与控制权

正式执行器使用 TerminalSession.sshConn 的独立 SFTP 通道，不再登录另一条 SSH 连接，不向终端写入文件操作脚本。每个文件操作拥有自己的 SFTP 通道；结束、取消或失去控制权时关闭该通道，保留原终端及其他通道。

打开通道前检查任务权限，解析目标后及每次后续 I/O 前重查控制权、任务范围、主机状态和规则。旧连接、旧 epoch、已断开的 MCP 客户端不能继续读取正文或提交旧提案。文件与命令仍共用同一任务队列和次数预算。

任务没有 fileScopes 时，新增文件工具不会给既有配对客户端自动增加文件访问权。文件路径规则独立于命令规则；人工自由终端的既有边界保持不变。

## 3. 不可变提案与人工审阅

保存提案绑定打开时版本、请求路径、规范目标、编码和拟保存的确切内容。任务动作只携带提案 ID、字节数及完整性标记，不携带正文。客户端可见的完整性标记使用进程内密钥生成，不能拿它对文件中保留的隐藏值进行普通摘要猜测。

协同模式中，保存操作先等待。用户点击“查看文件改动”，由仅供登录人工访问的接口读取原始内容和拟保存内容；按钮“已审阅，确认保存文件”提交绑定本用户、任务、操作、提案、摘要、策略版本及控制权的审阅凭据。

凭据有效期为 5 分钟。任务服务在批准前和异步审计完成后都检查凭据，旧内容、旧控制权或已过期的审阅不能批准新写入。MCP 不提供读取原始差异、签发授权或批准操作的工具。

自动模式可在已经确认的任务文件范围内执行保存；明确拒绝、版本冲突、未知结果、预算或控制权变化仍会停止后续动作。审阅或取消都不等于撤回已经到达服务器的提交。

## 4. 正文、脱敏与缓存

正文与提案默认只在内存保存，15 分钟到期。当前最多 128 份快照/提案，正文容量预算为全局 64 MiB、单用户 32 MiB；按文本存储成本计数，实际进程内存还包括对象与临时处理开销。正式自动读取单文件上限为 8 MiB；分页每次最多 64,000 个字符，使用返回的偏移继续读取，避免截断 Unicode 字符。

JSON 脱敏识别转义后的敏感属性名，并尽量保留原始格式，方便精确修改。常见秘密字段、认证容器、密钥文本、连接 URL 用户信息、Basic 认证和普通配置赋值会脱敏。识别规则是防护措施，不声称能够识别任何自定义格式中的所有秘密。

完整替换要求所有页面实际返回且没有脱敏；仅请求最后一页不满足这一条件。精确修改只匹配非隐藏片段，其他内容与原秘密保持不变。对不存在、被隐藏或不唯一的匹配不会写入。

操作日志只记录路径、版本、格式、状态和必要元数据，正文不混入动作或公共结果。人工文件读取及差异响应标记 Cache-Control: no-store，避免浏览器 HTTP 缓存落盘。外部编辑器和手动下载是用户明确发起的独立文件操作，不能据此推断没有本地文件。

## 5. 文件责任与依赖

| 文件/目录 | 责任 |
| --- | --- |
| backend/files/automated-documents.ts | 有界正文缓存、已读范围、精确修改、不可变提案、审阅凭据与文件执行器实现 |
| backend/files/content-redaction.ts | 保留可编辑格式的 JSON/文本脱敏，不负责 SSH 或审批 |
| backend/files/automation-schema.ts | AI/MCP 文件读取、分页、精确修改与完整保存的输入契约 |
| backend/files/production.ts | 组合现有 SSH 客户端与独立 SFTP 通道，签发内部能力并交给同一 DocumentService |
| backend/collaboration/files/automation.ts | 校验任务主体与当前控制权，再编排文件用例和任务提交 |
| backend/collaboration/audit/production.ts | 按用户取得审计日志，避免文件模块反向导入任务组合模块形成循环依赖 |
| backend/mcp/contracts.ts、core.ts、server.ts | 严格工具 schema、配对身份投影与 22 项工具目录 |
| backend/ai/tasks/file-tools.ts、runner.ts | 内置 AI 的文件工具说明、等待、脱敏上下文及根据结果重新决策 |
| ui/features/collaboration/FileOperationReview.tsx | 人工原文/改动对照、加载状态和审阅凭据提交 |
| backend/test-helpers | 有界本机 SFTP 与任务/文件测试夹具；已从正式后端编译中排除 |

表中的路径均在 app/src 下。核心通过公开的 FileExecutorPort 调用实现，传输持有 SSH 客户端，模型和 MCP 适配器不接触凭据、原始正文存储或审批签发器。

## 6. 验证范围

已验证标准 MCP SDK → stdio → Windows 系统凭据 → 签名本机管道 → 正式文件执行器 → 真实 SFTP 的自动与协同保存。两种模式均只建立一条 SSH 认证连接，保存后的磁盘字节与预期 CRLF 内容一致，客户端断开后任务权限撤销，原 SSH 连接仍可用。夹具的终端上下文探测由测试端口提供，不能将这一项单独当成真实 PTY 与全部桌面交互验收。

内置 AI 使用确定性本机模型夹具验证读取、保留秘密的精确修改、逐项人工确认和结果后的重新决策，没有调用收费模型。中文界面测试验证未加载正确差异时不能批准、凭据绑定和关闭时取消正文请求。

最终联合回归 **54 文件 / 407 项通过**，见 .cache/file-automation-packaged-regression.log。测试使用最终 TandemSSH.exe 与打包 stdio 入口，包含已有命令/保存流程的真实 PTY 回归。

本机 Codex app-server 实际发现全部 22 项工具，四个文件工具的中文标题与目录均已核对，见 .cache/codex-mcp-integration.json。该验证只用临时启动配置，没有创建 Codex 任务、修改全局配置或调用付费模型。

打包程序的两种文件模式证据为 .cache/file-native-automatic.json、.cache/file-native-collaborative.json：stdio + 签名管道 + 系统凭据、SSH 连接数 1、实际保存 20 字节、断开后撤权。

类型与相关模块 lint 通过，前后端构建和 Windows 解包验证包通过，日志为 .cache/file-automation-types.log、.cache/file-automation-lint.log、.cache/file-automation-build.log、.cache/file-automation-package.log。构建仍有既有资源块偏大和重复依赖引用提示，原生模块重编译采用 npmRebuild=false 的既有验证方式。

最终包在独立测试数据目录实际启动，中文页面 lang=zh-CN、同舟 SSH 标题和数据库“运行正常”已通过 DOM 与截图核对；见 .cache/file-tools-desktop-evidence.json、.cache/file-tools-desktop.png。此次是启动检查，不替代完整桌面文件编辑验收。测试应用正常退出，19323/19324 调试及相关后端端口无监听，见 .cache/file-tools-desktop-cleanup.json。真实 SFTP 在 Windows 文件系统上模拟部分 POSIX 所有者属性；完整 Linux/OpenSSH 的覆盖成功、权限/ACL 和断线矩阵仍需继续。

## 7. 继续完成的范围

当前工具聚焦已有文件的读取与编辑。自动另存为暂限同一已核实的实际目录；跨目录目标预览、目录浏览/元数据、上传下载工具和文件流程步骤继续接入，不改变原本完整文件工作台的要求。

完整桌面文件验收、文件操作/任务历史的持久恢复、加密草稿、旧宏与自动化入口收敛、剩余汉化、真实 Linux 矩阵及标准构建/开源发行门槛仍属于当前 Goal。Windows 验证包继续使用既有原生模块；不能据此声称缺少 Spectre 库的标准重编译问题已经解决。
