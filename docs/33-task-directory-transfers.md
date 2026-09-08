# AI/MCP 目录传输：任务目录授权与执行接入

2026-09-09，原生能力阶段记录。后续任务执行、AI/MCP 与中文工作台进展见 [第 35 份文档](35-directory-workbench.md)。

本阶段：完整目标包含目录双向传输、逐项可见结果、自动执行、协作审批、接管及恢复。本轮完成原生目录授权和受控 I/O 能力；目录专用 AI/MCP 预览、执行、状态工具和完整桌面入口仍在后续接线，不宣布目录自动化已经整体完成。

## 已确定的执行边界

- 用户在原生目录选择框中选择来源或目标；模型只能使用任务拥有的目录授权 ID/版本，不接受模型指定的本地绝对路径。
- 上传固定扫描到的条目集合，保留空目录，链接和特殊文件排除；扫描后新增文件不自动加入。文件内容读取继续使用版本和分块摘要检查。
- 下载先固定远端集合与本地映射，预览不创建目录或覆盖文件。改名/跳过/合并/覆盖仍遵循原目录用例；覆盖还必须取得任务本地目录授权中的允许。
- 目录授权只表达本地范围。它不能代替远端路径规则、任务控制权或操作预算；后续执行必须进入 TaskRuntime/OperationGateway，不能直接把原生能力暴露给 MCP。
- 后续目录批次按条目分配操作 ID、记录结果并消耗任务操作预算；一次目录请求不能绕过逐项规则。任务预算耗尽时保留已完成项，重新授权后继续剩余项。
- 协作模式显示本次清单、冲突选择和每个动作；自动模式只能在已授权范围推进。接管、失效授权、审计失败、未知结果均停止后续自动 I/O。已成功项目不自动重做，未知项目需核实。

## 已实现的原生能力

| 模块 | 责任 |
| --- | --- |
| electron/task-local-directories.cjs | 固定目录根、扫描快照、目录预览所属关系、受控子文件能力、撤销和清理 |
| electron/task-upload-access.cjs | 文件与目录共用的版本检查、摘要准备、分块读取和关闭；两个调用方为 TaskLocalFiles 与 TaskLocalDirectories |
| electron/upload-sources.cjs | 原有扫描器增加可选内部授权回调，在递归扫描前后检查；继续负责路径/文件身份和只读块访问 |
| electron/download-directory-targets.cjs | 原有目标用例增加授权钩子、逐目录审计及首错停止；子文件最终提交复用 DownloadSink 的授权检查 |
| electron/task-local-files.cjs | 将目录能力整合进既有原生任务文件入口，普通文件行为保持兼容 |
| backend/files/local-file-grants.ts | kind=directory 的选择票据、任务/会话/版本/方向/覆盖授权核对、目录能力访问和只读检查 |
| backend/files/local-directory-ports.ts | 原生目录内部端口与授权引用契约，业务层通过此入口调用，不依赖 Electron 页面或任意本地路径 |
| electron/task-local-files-ipc.cjs | 可信主窗口、私有进程通道和中文目录选择框；目录选择不能退化为文件选择或保存框 |

主智能体负责以上模块。依赖方向为任务授权 → 原生目录能力 → 既有扫描器/目标服务/分块服务。没有新增通用 utils 层，也没有复制文件分块状态机。两个新 CJS 文件已列入 asarUnpack，供打包后的本地后端使用。

目录能力采用与文件一致的用户、任务、会话和连接代次绑定，最长 8 小时，并在窗口关闭、任务结束、身份变化或撤销后失效。单文件接口拒绝目录授权；文件流程的本地绑定列表也排除目录。

原生目录授权最多全局 8 份、每用户 4 份，同时选择最多 2 个；同一授权最多 4 个上传读取或 4 个下载子文件能力。扫描和目标预览沿用每批 4096 项/64 层/2 MiB 元数据限制及原有预览容量。目录授权可在本任务内复用；每个确认后的下载预览不可重新定向，已完成子文件不会重复绑定。关闭文件能力后不能继续读取数据；已完成下载保留只读结果。

创建目录前写入 entry-started，核实后写入 entry-completed。审计在写入前失败时不创建该目录；创建后无法写审计或核实结果时保留 unknown。自动调用选择 stopOnError，剩余目录不再创建。原有人工目录队列不传新钩子时保持原先行为。

## 内部接口约定

人工票据请求可携带 kind=directory；省略时仍为普通文件。主进程据此显示“选择本任务的上传目录”或“选择本任务的下载目录”，并仅返回所选目录路径到私有后端通道。

LocalFileGrants.directory(context, reference, guard, signal) 验证目录授权后返回 NativeTaskDirectoryAccess。reference 包含 localGrantId、localVersion、direction、overwrite；guard 由未来的任务动作网关提供，不能由 HTTP/MCP JSON 提供或省略。目录创建还需逐项 guard 和 audit。只读目录检查与取消/释放用于本任务拥有的预览；检查结果包含人工本地路径，未来模型适配器必须投影为不含本地绝对路径的 DTO。

目前没有在界面新增一个尚不能执行完整目录任务的按钮，也没有让既有 upload_file/download_file 冒充目录传输。原生目录选择通道和能力由后续目录工具/工作台接线调用。

## 验证与剩余接线

新增实际本地文件测试覆盖上传快照、链接排除、空文件/空目录、字节与 SHA-256、来源改变、已打开能力撤销、关闭后禁止读取、预览无副作用、覆盖/版本冲突、路径越界、父目录被链接替换、逐项授权失败、写前/写后审计失败、最终提交前接管、选择中窗口关闭和容量回收。新目录及私有 IPC 专项 2 文件 / 19 项通过，.cache/native-directory-boundary-tests.log；原有能力初轮 7 文件 / 48 项通过，.cache/native-directory-existing-tests.log。

接下来完成：远端目录清单的任务化预览、逐项任务执行和预算继承、AI/MCP 工具与中文批次审核、接管后的恢复点、实际桌面自动/协作双向目录验收。跨重启检查点、完整 Linux/OpenSSH 权限与断线矩阵仍在完整目标中。本轮原生测试不能替代这些未完成场景。

## 逐条目入口与本轮验证

本地 DownloadDirectoryTargets 和远端 UploadTreeService 均新增内部单目录条目选择。选择某一条目时只处理该目录，拒绝不存在的 ID 或文件条目；父目录尚未就绪时不越级创建。这为后续每个目录独立审批、独立操作 ID 和独立预算计数提供入口，原有人工整批调用保持兼容。

联合回归 23 文件 / 177 项通过（.cache/native-directory-regression.log）。补充单条目选择后，本地目录授权、真实 SFTP 目录创建和原目录目标回归 3 文件 / 30 项通过（.cache/native-directory-entry-tests.log）；完整类型、中文静态键检查和改动模块 lint 通过。测试范围有重叠，不将这些数量相加为新的完整验收计数。

安装包原生探针已新增 fileCapabilities、directoryCapabilities：在实际 TandemSSH.exe 内核对 6 个文件能力模块位于解包资源目录，并实例化、释放原生任务文件能力。此项验证模块打包和加载，不替代后续 AI/MCP 目录操作全链路验收。

## 最终包与后续工作

最终前后端构建和 Windows 解包验证包通过（.cache/native-directory-final-build.log、native-directory-final-package.log）。在实际包内运行原生探针，fileCapabilities、directoryCapabilities、SQLite、串口、系统凭据和捆绑 ConPTY 均为 true，依赖检查为 13 项；6 个能力模块的 SHA-256 与当前源码一致（.cache/native-directory-package-probe.log）。实际打包 MCP stdio 回归 2 文件 / 3 项通过（.cache/native-directory-packaged-stdio.log）。本地包仍复用已验证原生模块，标准重编译与安装检查由 CI 执行。

本轮没有新增对外目录 MCP 工具或宣布整批自动化完成。下一步必须把这些能力接入目录预览记录、每条目的任务动作与预算、AI/MCP 工具以及中文目录任务界面，并完成自动/协作的真实 SSH/SFTP 目录场景。已有命令、单文件和混合流程继续可用。
