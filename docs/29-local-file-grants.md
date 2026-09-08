# 任务本地文件授权

状态：生产本地授权与中文界面已接入，实际桌面验证通过。当前可选择多个普通上传文件或一个精确下载目标；AI/MCP 的新传输工具、保存流程文件步骤和自动目录批次仍继续接入，不能把本轮授权功能当作这些入口已经完成。

## 用户行为

协作执行面板中，每个任务有“本任务的本地文件授权”。先选择是否允许本次资源覆盖目标，再点击“选择上传来源”或“选择下载目标”。来源支持原生文件选择器多选；下载目标使用原生保存对话框确定精确文件位置。选择过程只建立授权和版本基线，不写入上传目标或下载文件。

面板显示完整本地路径、文件大小或已有目标大小、可用/撤销/已使用状态和覆盖权限。撤销立即阻止继续使用；“清理并移除记录”只处理本能力拥有的临时文件与记录，不删除成功下载的最终文件或上传来源。结果未知、替换过的临时文件或仍在使用的记录不会被强行清理。

授权属于当前用户、任务、SSH 会话、服务器身份和连接代次，最长 8 小时。退出登录、窗口导航/关闭、任务结束、连接代次变化或撤销后不可继续使用。人工接管仍由任务网关撤销旧执行控制；同一任务已选资源可以保留，新的操作仍需新的任务授权，旧操作审批不能复用。下载目标成功使用一次后标为已使用，再次下载需重新选择并取得新基线。

## 文件责任与依赖

- types/local-file-grants.ts：UI/主进程的授权、票据和原生 API DTO。
- files/local-file-grants.ts：窗口令牌、短期票据、任务/用户归属、版本、覆盖、容量与撤销；实现 TaskLocalTransferPort。
- files/local-file-routes.ts：登录人工接口及输入校验；拒绝 API Key，不接受原始本地路径。
- files/local-file-bridge.ts：既有 fork 私有 IPC 协议、受限消息与进程断开处理，不监听新网络端口。
- electron/task-local-files-ipc.cjs：仅可信主窗口顶层页面可调用的原生选择器、后台 RPC、窗口与登录重置。renderer 不能调用 fulfill 或提交路径。
- electron/task-local-files.cjs：纯 Node 文件能力；复用 UploadSourceStore / DownloadSink / 既有名称校验，拥有来源版本、目标基线、句柄与临时文件。
- files/local-file-production.ts：后台运行环境、固定模块加载入口与任务上下文适配绑定。
- files/automated-transfer-production.ts：把上轮二进制执行器组合进现有任务 FileExecutorPort，复用当前已认证 SSH 的 SFTP 通道和共享提交锁。
- ui/api/local-file-grants-api.ts 与 TaskLocalFiles.tsx：HTTP 适配、中文选择/管理面板和账号生命周期。AppShell 只安装重置监视器，TaskPanel 只编排对应任务的面板。

本地文件 I/O 在任务网关所在后台进程执行，授权守卫与实际块读写/最终提交在同一进程。Electron 主进程负责可信选择动作，不通过 renderer 转发文件字节。后端和页面不反向依赖对方的内部实现；共享入口只承载明确的传输业务契约。

## 选择票据与进程通道

1. 主窗口通过私有 IPC 注册随机窗口令牌。
2. 登录人工为自己的任务申请 5 分钟单次票据，绑定窗口令牌、方向、覆盖选择和任务身份。
3. 主进程向后台 claim 票据，依据后台返回的方向打开原生选择器。
4. 主进程将实际选择的路径通过父子私有 IPC 交回后台兑换。后台复核票据、窗口和任务，再建立文件能力；审计完成后才公开授权。
5. 关闭窗口、退出登录或取消选择会取消票据。读取基线期间也会检查有效性，迟到结果不能产生新授权。

通道支持 bind / claim / fulfill / cancel / close，消息上限 256 KiB，单次最多 32 个文件路径；一般请求最多 8 项在途，取消/窗口撤销不被满队列阻塞。窗口重置的调用等待后台确认撤权。通用 renderer invoke 禁止直接访问该保留通道，typed preload 只暴露 identity / choose / reset。

HTTP 前缀 /tandem/local-files，提供 tasks/:taskId 的列表、tickets、票据取消和 grants/:grantId 的 revoke/forget。所有响应 no-store。任务所有权来自认证用户及 TaskRuntime，窗口不能通过传 userId 来切换身份。公共任务能力视图只含名称、大小、ID/版本等元数据；完整本地路径只由人工接口返回，不进入公共操作 DTO。

总授权上限 128、每用户 32，并发选择上限 2，包含在途容量预留。原生上传来源存储另外保留每用户最多 4 组选取、全局最多 16 组的既有上限；一次可多选文件。到达额度需处理并清理已有记录。未知结果和待清理临时文件仍需用户核对；跨重启持久恢复没有因此完成。

## 原生来源与目标

上传保留选择时的文件身份、大小和时间版本；读取与最终校验仍通过已有受控块读取，包括空文件。链接、特殊文件和目录不会隐式成为普通文件授权。

下载保存规范父目录、目录身份以及已有目标的完整摘要基线。开始写入时再次核对所选基线，不能在目标变化后默默扩大覆盖授权。模型给出的 overwrite 只有在本地授权允许且任务/远端规则也允许时才生效。目标成功使用后不复用旧基线。

原生模块打包到 app.asar.unpacked/electron，供同一包内的后台进程使用；只解包所需的四个纯 Node 文件模块。standalone 服务或没有父子 IPC 的环境不能建立本机文件授权。已创建的原生实例在父进程断开时仍可用于关闭句柄和撤销，不再新建能力。

## 实际验证

- 本地文件与 HTTP、原生选择器/RPC、中文界面及原有任务面板专项 **4 文件 / 25 项通过**，.cache/local-file-grants-boundary-tests.log。覆盖跨用户、版本变化、显式覆盖、目标变化、下载完成后保留最终文件、单次兑换、审计失败、窗口/连接代次/任务结束、并发用户额度、iframe/任意操作拒绝、迟到选择和满队列撤权。
- 联合回归 **469 项通过、1 项跳过**，.cache/local-file-grants-regression.log。该 MCP 用例依赖编译产物存在，与构建并行时未运行；产物就绪后指定实际打包入口补跑 **1 项通过**，.cache/local-file-grants-packaged-mcp.log。后续不将依赖同一构建产物的检查与重建并行。
- 类型检查通过，.cache/local-file-grants-types-final.log；改动模块 lint 无错误/警告，.cache/local-file-grants-lint.log；中文静态键缺失为 0。前后端构建和本地 Windows 解包包通过，.cache/local-file-grants-build.log、.cache/local-file-grants-package.log。仍有既有大资源块提示；本地验证包复用原生模块，标准重编译由 CI 检查。
- 真实桌面连接测试 SSH 并创建任务，完成上传来源和下载目标授权、来源撤销/移除、窗口重置后撤权；选择和清理授权未改写来源或最终目标。证据 .cache/desktop-observation-report-f99a3319-02f3-4e19-ba57-e2eaca475887，含 local-file-grants.png、local-file-grants-revoked.png、local-file-grants-result.json。应用与验证进程正常退出，.cache/local-grants-desktop-observer-final.log。

原生选择器由测试主进程提供专用测试路径，未声称人工操作过系统对话框。首次桌面检查已成功退出应用，但 Node-PTY 测试夹具遗留 ConPTY 工作线程；按已核对的依赖实现释放夹具自身工作线程后重新完整验证通过，没有更换应用的 ConPTY 实现或关闭 Spectre 检查。

本轮仍未通过生产 AI/MCP 新传输工具执行文件往返，也未完成保存流程中的文件步骤。下一步接入已授权能力的工具查询、上传/下载、进度与恢复，再完成真实自动/协作文件流程和 Codex 工具发现。自动整目录、历史/草稿/凭据、认证/隧道/监控、跨版本升级、Linux/压力/许可证和全量验收范围继续保留。
