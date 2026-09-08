# 带版本的在线文件编辑

更新日期：2026-09-07。本轮完成可信人工编辑入口的后端、中文界面与专项测试。它是完整文件工作台的一部分；AI/MCP/流程的文件动作、传输队列和桌面端完整验收仍在继续，不能据此认定首版已交付。

## 1. 当前行为

打开文件后，在内存中保存打开时的内容和独立草稿。点击保存或 Ctrl+S 先进入审阅页，展示实际连接身份、请求路径、解析后的保存目标、权限、原文与待保存内容。不会因停止输入 60 秒就自动上传。

- 空字符串是有效草稿，可以把文件保存为空；普通文本如 test 不会被猜测为 Base64 后解码。
- 保存只确认提交时的那份草稿。保存期间到达的新编辑仍保持未保存状态，不被迟到响应清除。
- 原文、远端最新内容和本地草稿分别展示。用户可保留草稿并以最新版本继续合并，或采用远端内容；再次保存需重新审阅。另存为只允许创建尚不存在的目标。
- 响应丢失或提交后校验失败时，显示结果待核对，阻止盲目重试。刷新保留草稿；另存为的未知结果刷新实际尝试保存的新路径。
- 关闭有修改或正在保存的编辑器会先展示中文确认。关闭取消后续请求，撤销该文档基线并释放连接占用；已经送出的远端操作仍可能完成。
- 外部编辑器的改动先进入本地草稿，再由用户在应用内审阅保存；若内置编辑器也有新改动，不静默替换内置草稿。
- 同一主机有自动任务时，人工保存要求明确接管。保存期间，任务授权和实际命令派发都检查主机文件操作状态。接管不能撤回已在远端运行的命令。

当前对照页提供并列完整内容，尚未提供逐行着色的差异补丁或自动三方合并算法。草稿默认只在内存中，重启后的加密恢复尚未实现。

## 2. 编码和大小

已实现 UTF-8、UTF-16 LE/BE、GBK 和 GB18030 的往返校验，保留所选编码、BOM 与统一的 LF/CRLF/CR。无法无损表示内容时拒绝保存；已有 BOM 与显式解码选择冲突时拒绝误解码。混合换行要求用户选择目标格式。

当前编辑上限为 8 MiB，完整读取预览上限为 32 MiB；更大内容使用下载。不可解码内容允许选择编码重新读取，二进制内容不开放文本保存。大文本只读页只显示部分内容。这些是当前实现阈值，不表示大文件传输与全部媒体格式已经验收。

## 3. 保存契约

| 入口 | 输入与结果 | 约束 |
| --- | --- | --- |
| GET /ssh/file_manager/ssh/readFile | sessionId、path、可选 charset、editor=true → content、encoding、document | 编辑器不复用预览缓存；path 仅由 HTTP 层解码一次 |
| POST /ssh/file_manager/ssh/writeFile | sessionId、path、content、version、requestId，及可选 format/takeover/saveAs → 新 document、bytes、atomic、warnings | version 和 requestId 必填；旧无基线写入结构被拒绝 |
| POST /ssh/file_manager/ssh/closeDocument | documentId → closed | 关闭逻辑文档及其全部基线，不使用单次保存 version |

version 绑定用户、主体、原请求路径、解析目标、SSH 连接和内容/属性快照。相同请求 ID 与相同内容只执行一次；同 ID 内容变化拒绝执行。文档 ID 跨成功保存和冲突基线保持稳定，以便关闭后释放一份连接占用。

保存顺序：解析目标与权限检查 → 应用内目标互斥 → 必要时人工接管 → 核对远端摘要及属性 → 同目录独占创建临时文件 → 分块写入 → 保留 mode/uid/gid → 校验临时内容 → 再核对原文件 → 支持的重命名提交 → 重新读取并核对结果 → 记录新基线。

覆盖依赖服务器的 OpenSSH 原子重命名扩展。缺少扩展时失败并保留原文件，不通过删除原文件后重命名来降级。另存为使用不得覆盖现有目标的创建语义。失败返回可能遗留的临时路径及提交是否可能发生；当前没有自动清理远端临时文件的入口。

摘要与属性检查不等于针对其他程序的原子 compare-and-swap。外部程序仍可能在最后检查与提交之间改动文件；应用不会承诺绝对消除此竞态。当前互斥以连接目标身份及规范路径为键，DNS 别名、硬链接及外部进程不构成全局文件锁。ACL、扩展属性和全部服务器元数据也尚未获得保留验证。

## 4. 文件责任与依赖

| 文件/目录 | 单一责任与公开边界 |
| --- | --- |
| app/src/types/file-document.ts | 前后端文档、保存和失败 DTO，不依赖 UI 或后端实现 |
| app/src/backend/files/document-service.ts | 基线、请求去重、版本冲突、提交顺序与文档生命周期；通过 ports 访问 SFTP/审计/接管 |
| app/src/backend/files/encoding.ts | 无损解码、编码、BOM 和换行转换；不处理网络或权限 |
| app/src/backend/files/sftp-io.ts | ssh2 SFTP 回调适配、超时、分块 I/O、句柄清理和重命名；不执行 Shell 或隐式提权 |
| app/src/backend/files/production.ts | 组合现有文件会话、审计和接管；仅开放可信人工主体，自动文件入口仍显式拒绝 |
| app/src/backend/hosts/file-manager/document-routes.ts | 登录人工身份与输入校验、断开取消、HTTP 错误投影；不承担保存规则 |
| app/src/backend/collaboration/sessions/host-file-fence.ts | 人工文件提交期间的主机占用；任务运行器在授权和写入前读取 |
| app/src/ui/api/file-document-api.ts | 编辑 API 适配，保留冲突与未知结果信息，不执行业务判定 |
| app/src/ui/features/file-manager/hooks/use-file-document.ts | 编辑基线、草稿、保存快照与恢复状态，不直接调用 SFTP |
| app/src/ui/features/file-manager/components/FileDocumentReview.tsx | 中文保存审阅和三方对照；不签发自动任务权限 |
| app/src/ui/features/file-manager/components/FileWindow.tsx | 连接、编辑器、审阅及关闭的界面编排 |

没有新增 common/utils 等跨业务共享目录。文件用例定义端口，生产组合入口提供实际适配；任务领域不反向依赖具体文件编辑器，通过会话的 assertAvailable 公开检查协调授权。

## 5. 验证证据

最终专项验证 5 文件 / 59 项通过，见 .cache/file-document-final-tests.log，包含真实本机 HTTP、SSH/SFTP 通信和前端状态测试。最终联合回归 25 文件 / 212 项通过，见 .cache/file-document-regression.log；类型、相关新模块静态检查和前后端构建通过，分别记录于 .cache/file-document-types.log、.cache/file-document-lint.log、.cache/file-document-build.log。构建仍提示既有资源块较大。

实际协议夹具使用随机回环端口、随机测试口令及工作区独立目录；服务和文件句柄在结束后关闭。它验证了中文及字面 %2F 文件名、多块读写、另存、拒绝覆盖已有路径和服务器不支持原子覆盖时原文件保持完整。Windows 夹具模拟 POSIX 所有者信息，不能替代真实 Linux/OpenSSH 元数据与原子覆盖的正向测试。

已覆盖：空文本、编码往返、混合换行与有损拒绝、同大小/mtime 的内容冲突、保存中发生外部修改、重复请求、其他用户/旧连接基线、符号链接目标变化、并发保存、取消/关闭、暂存与提交失败、未知结果、草稿保留、HTTP 所属用户校验，以及慢审计期间人工保存阻止自动授权。

测试中发现并修正了关闭接口 documentId/version 不一致，以及另存为响应丢失后刷新原路径的问题。夹具的初始密钥格式、缺少的断言扩展及未安装的 supertest 均已改为项目可用的形式；HTTP 测试使用 Node 自带 server/fetch，无新增测试依赖。

## 6. 继续实施与验收

本轮尚未运行新版打包桌面的完整文件编辑验收，现有 win-unpacked 包仍是前一轮产物。不得用本轮源码测试声称桌面文件工作台已经验收。

下一步将文件动作接入 AI/MCP/流程的统一策略与任务生命周期，并继续传输队列、断点恢复、文件流程步骤、草稿加密恢复及操作历史。保留完整既有功能目标，继续真实 Linux SSH/SFTP 矩阵、中文桌面实测、旧自动化入口收敛、秘密存储和标准构建/发行验证。
