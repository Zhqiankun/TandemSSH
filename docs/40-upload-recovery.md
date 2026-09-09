# 上传跨重启恢复

2026-09-09，单文件上传恢复已接入真实 Windows 桌面和中文界面：暂停后显式保存加密进度，重启后重新选择来源并完整核验，恢复到暂停队列，再确认继续。正常重启和模拟应用中断后续传均已验收。目录和 AI/MCP/流程的跨重启执行恢复仍待完成。

## 责任与依赖

- UploadService 拥有目标、块清单、已确认偏移、提交状态和写入占用；导出仅允许已暂停且无未决提交的任务。恢复不使用旧连接或写入占用，新的记录先停在暂停状态。
- upload-contracts 定义请求和检查点的可序列化契约，沿用原入口的清单校验。检查点包含用户、实际目标身份、公钥、请求/规范路径、临时路径、目标基线、父目录约束和已确认偏移，不含密码、私钥和旧批准。
- privacy/system-record-key 与 encrypted-record-codec 只提供操作系统密钥和 AEAD 编解码；草稿与上传恢复是两个实际调用方，业务对象与容量策略继续归各自模块。抽取必须保留旧草稿的密钥命名、TDF1 头和 AAD 字节契约。
- 加密恢复存储拥有记录及占用/提交状态；HTTP 只做当前人工身份、输入及新会话转换。AI/MCP 不获得人工恢复接口。
- UI 复用 UploadQueue 和 uploadManifest：用户重新选择 File，完整校验清单后才请求恢复，已有目标/接管重新确认，恢复本身不向远端追加字节。

依赖方向：中文界面 → 上传恢复用例 → UploadService 或加密存储 → 文件 I/O/操作系统密钥。业务模块不能导入另一业务模块的私有存储；公共加密能力不依赖草稿、上传或页面。

## 验收

1. 旧草稿密文可读写，系统密钥不可用不写明文。
2. 暂停上传首块后关闭旧实例，在新连接/进程中核对并继续；最终内容完整。
3. 错误用户、公钥、来源清单、目标基线、规范路径或已确认前缀变化时拒绝，不清理不明目标。
4. 重新确认覆盖，人工接管仍通过原写入占用；恢复检查本身不截断或发送新块。
5. 检查点持久化失败保留当前任务；未知提交不重跑。核心用例和实际加密存储、中文入口、应用重启分别验证，证据见下文。

## 第一阶段：恢复核心与存储

UploadService 可从已暂停、已确认创建临时文件且无未决提交的记录导出检查点。持久化完成前阻止并发修改，失败保留原暂停任务，成功后移除旧运行记录。新连接恢复重新校验用户、目标身份、已接受主机公钥、完整来源清单、目标基线及临时文件已确认前缀，生成新 ID 并保持暂停；恢复检查不写远端、不截断未确认尾部，也不取得旧写入占用。实际继续必须重新通过原 resume 的人工接管与写入锁。服务已 dispose 时不会复活迟到恢复。

UploadRecoveryStore 使用单独的操作系统服务命名和 TUR1 AEAD 格式，按用户保存生成文件，支持占用、提交、未知结果和结束状态。修改检查点不能改变原来源、目标或基线；原密钥缺失时不重新生成密钥掩盖旧记录。每份记录最多 4 MiB、每用户最多 128 份/64 MiB。第一阶段只验证存储；第二阶段的 HTTP/窗口生命周期和用户入口已接入，见下文。

公共加密模块由 privacy 层拥有，只提供固定帧头/AAD 的 AES-256-GCM 编解码及当前系统账号的密钥接口；草稿和上传恢复是两个真实调用方，各自保留业务校验与文件存储。旧 TDF1 密文可由新解码器读取，新密文也通过旧解码方式复核；草稿原服务名、账号推导和错误映射保留。没有把上传业务耦合到草稿私有存储。

新增专项 **5 文件 / 19 项通过**，包含旧草稿格式双向兼容、真实 SFTP 前缀、来源/身份/目标变化拒绝、重新覆盖同意、人工接管、持久化失败和已释放服务拒绝恢复。随后完整相关回归 **96 文件 / 641 项全部通过**，覆盖草稿、下载、上传、文件工作台、AI/MCP、自动与协作网关。类型、模块 lint、后端构建和 Windows 解包包通过。

独立进程测试已提交为 scripts/upload-recovery-process.test.ts 与 scripts/test-helpers/upload-recovery-worker.mjs：实际本地文件首个 4 MiB 块经真实回环 SFTP 上传，检查点加密保存后销毁旧服务；新 Node 进程重新读取并校验本地文件，通过新的 SSH 连接继续剩余 77 字节，最终远端全部字节和 SHA-256 一致。测试加密密钥与 SSH 测试凭据仅通过子进程 stdin 传入，不写入检查点或命令参数。它证明新进程恢复核心，不能代替实际桌面恢复入口验收。

真实 Windows 系统密钥探针分别验证草稿和上传恢复服务中随机测试条目的 32 字节密钥创建、重读和清理；最终包的原生探针通过 13 项依赖及 SQLite、串口、keyring、ConPTY、文件/目录能力，打包 stdio/Codex 3 项通过。

证据日志：.cache/record-crypto-compatibility.log、.cache/upload-recovery-foundation-tests.log、.cache/upload-recovery-record-tests.log、.cache/upload-recovery-regression.log、.cache/upload-recovery-delivery-types.log、.cache/upload-recovery-delivery-lint.log、.cache/upload-recovery-system-keys.log、.cache/upload-recovery-native-probe.log、.cache/upload-recovery-packaged-mcp.log。

契约抽取时曾遗漏 posix 导入，造成旧上传回归失败；修复共同根因后旧上传/自动协作 23 项及上述完整回归通过。根目录父约束的类型推断和测试 finally 异常覆盖也已修正，没有跳过失败用例或降低校验。

上一下载恢复提交 dec05aa 的 CI 34301438766 已全部成功，包含此前失败的解包依赖门槛和安装/卸载验证。本机包继续复用已验证的原生模块（npmRebuild=false），不代表重新执行了云端标准原生编译；本次推送云端结果另行核对。

## 生产接入验收要求（第二阶段已落实）

- 通过可信窗口生命周期绑定当前人工用户、恢复记录和新会话；退出或窗口中断时保留已保存的上传部分文件，不能沿用普通队列的 cleanup=true 删除行为。
- 提交前持久化 committing；明确完成后才记 completed，结果未知只允许核对，不重复提交。丢失窗口时撤销旧运行能力、停止后续块，再释放持久化占用。
- 中文恢复清单按需加载来源清单，用户重新选择 File 并完整校验；新目标覆盖和人工接管重新确认，恢复先回到暂停队列。保存成功后清理 UI 行不删除恢复记录。
- 真实应用重启与中断验收已完成；目录批次和 AI/MCP/保存流程的跨重启恢复继续单独实施。

临时文件身份仍受标准 SFTP 可观测信息限制，不承诺对有权限修改远端目录的外部进程提供原子 compare-and-swap。真实 Linux/OpenSSH、权限/断线/大文件矩阵与全套 A01–A37 继续保留，完整 Goal 未完成。

## 生产接入与窗口生命周期

上传恢复使用独立的主进程窗口标识：只有当前可信窗口能注册/关闭标识，人工 HTTP 请求将真实用户绑定到该窗口。恢复协调器持有上传运行 ID 与加密记录的对应关系；API Key 无权操作恢复记录。

恢复任务退出时先撤销运行、等待已有块结束，再释放写入占用并保存新检查点，不调用普通上传的 cleanup=true 删除部分文件。提交前持久化 committing；明确结果再记录 completed/unknown。释放持久化状态失败时保留重试信息，不能把仍在运行的任务重新分配。

界面在上传队列为空时仍提供恢复入口；按需读取清单，重新选择 File 并逐块核验后恢复为暂停任务。已有目标要求新的覆盖确认，实际继续沿用原接管提示。未知提交只核对结果，不直接重试。

## 第二阶段：中文恢复入口与实际桌面验收

新增文件责任与依赖：

- electron/upload-recovery-window.cjs 负责可信窗口的标识与后台私有 IPC 生命周期，upload-source-ipc.cjs 沿用原主窗口/主框架校验；不允许 HTTP 注册窗口。
- backend/files/upload-recovery-coordinator.ts 负责人工用户、窗口、运行上传与加密记录的绑定、提交状态及退出交接；bridge 只转换私有 bind/close 消息，production 组合既有上传服务和存储。
- hosts/file-manager/upload-routes.ts 提供 list/detail/save/restore/check/discard/remove 人工入口，拒绝 API Key；原上传继续、结束与取消入口经过恢复协调。
- ui/api/upload-recovery-api.ts 负责协议转换；UploadRecoveryDialog.tsx 负责中文人工审阅和来源选择；UploadQueue 负责暂停、持久化交接、容量预留与账号变化后的队列失效。types/upload-recovery.ts 是两端公开数据契约。

没有新增通用业务抽象或反向页面依赖。原生重置通过 UploadQueue 的可注入适配入口调用，队列在 Node 验证环境中不要求存在 window。HTTP 不接收任意本地路径，File 由用户在当前窗口重新选择。

已保存记录恢复后，关闭窗口或退出账号会停止后续块、等待当前块结束并保存确认偏移；不会沿用普通取消的删除部分文件行为。提交前持久化 committing，响应丢失时进入 unknown；只有核对远端完整内容成功才结束，不自动重跑提交。用户明确放弃恢复时，重新核对身份和部分文件后清理本任务临时文件。

专项 **3 文件 / 11 项通过**，包括真实 SFTP 窗口关闭和迟到块、未知提交核对、用户/窗口隔离、再次保存和显式放弃，以及界面文件变更拒绝、覆盖确认、延迟结果账号隔离和退出保留。最终相关回归 **99 文件 / 652 项全部通过**；类型、改动模块 lint、中文键、前后端构建和 Windows 解包包通过。首次全回归暴露队列直接访问 window 的平台边界问题，修复为原生重置适配入口后完整复测通过，没有跳过失败用例。

真实 Windows 桌面验收使用独立测试配置、真实回环 SSH/SFTP 和实际本地文件：先上传并暂停，显式保存加密进度，正常退出；同配置重启后重新选择原始文件，核验并恢复到暂停，模拟应用进程树中断；再次重启、重新选择来源并续传，最终远端 **12,583,123 字节**，SHA-256 **73ac96d47edb68c7af257bd516d8f9c931d4dfca40a317d97762741c4ef2113a**。第一次和最后一次正常退出，中间强制中断是受控故障注入。来源由 CDP 对实际文件输入框设置测试文件，不能表述为人工操作系统选择框验收。系统密钥属于隔离测试配置，验收后清理；没有连接业务服务器。

最终 Windows 包原生探针通过 **13 项依赖及 SQLite、串口、系统密钥、ConPTY 和文件/目录能力**，最终包的 MCP/隔离 Codex **2 文件 / 3 项通过**。本机解包沿用已验证原生模块（npmRebuild=false）；标准云端原生编译和安装验收以对应提交的 CI 为准。上一核心提交 a04a7eb 的 CI 34304998461 已全部成功。

本轮证据：

- .cache/upload-recovery-production-regression-final.log
- .cache/upload-recovery-production-tests.log
- .cache/upload-recovery-production-types.log
- .cache/upload-recovery-ui-lint-final.log
- .cache/upload-recovery-ui-build.log、.cache/upload-recovery-ui-package.log
- .cache/upload-recovery-ui-native-probe.log、.cache/upload-recovery-ui-packaged-mcp.log
- .cache/upload-recovery-desktop.log
- .cache/desktop-observation-report-eb271dc9-eaa7-45a2-b599-7114170c3763/result.json
- 同证据目录内 save/upload-recovery-save.png、interrupt/recovered-upload-paused.png、restore/upload-recovery-restore.png

本次范围是人工单文件的显式保存恢复。未保存过的任意任务中断、目录批次和 AI/MCP/流程跨重启续跑、离线记录管理及真实 OpenSSH/大文件/权限矩阵仍未验收；实际跨版本在线升级与全套 A01–A37 继续保留。完整目标未完成。
