# 下载目录的任务恢复

继续完整双向目录与自动/协作目标。在第 47 阶段上传目录恢复上接入下载目录的完整条目边界；部分文件和独立目录批次协调器仍属于后续组合，不以条目边界替代。

TaskRuntime 的异步保存/持久化入口先请求目录游标准备快照，同步 recoverySnapshot 仍只读取已经准备好的可信状态。下载目录快照由 DirectoryTransfers 组合远端 DownloadTreeCheckpoint 和原生 DownloadDirectoryTargets 检查点；前者约束源清单及服务器身份，后者核验本地目录身份、完成文件的身份/时间/大小及 SHA-256。快照缓存按实际条目动作失效，避免未改变的状态重复读取；没有新授权时不进行恢复派发。

恢复时用户必须重新选择原下载目录并授权。新预览在既有网关中先恢复固定源清单，再通过新原生能力恢复本地目标，旧路径不是访问能力。已核验目录按合并处理，完成文件只跳过，不重新覆盖；新的清单确认和未完成项继续按自动/协作模式执行。来源或完成文件改变会明确失败并停止。

主智能体负责：types/directory-step-recovery 的区分联合、files/directory-step-checkpoint 的格式校验、DirectoryTransfers 的状态与缓存、DirectoryWorkflowSteps 的准备端口、TaskRuntime 的异步保存协调、原生 TaskLocalDirectories 的受控目标恢复，以及中文进度与错误提示。依赖继续是 UI/MCP → 任务恢复 → 目录步骤/传输服务 → 原生目录与 SFTP，原生模块不依赖任务页面。检查点私有数据仅进系统加密记录，不从 MCP 详情返回。

验证覆盖自动和协作的新授权、完成项不重写、来源/目标变化拒绝、未知在途条目保护、既有上传恢复回归和真实 Windows 重启。异步快照失败不继续派发；保存失败保留暂停任务。全部结果以实际文件和进程证据记录，不以接口存在宣称完成。

## 当前实现与回归

下载目录检查点现已采用 direction 区分联合，保留旧上传格式兼容；新增下载源路径/规范根、远端固定清单和私有原生目标快照。恢复详情按方向显示“下载目录进度”及重新选择原目录的中文提示。已完成文件在新清单中强制跳过，已核验目录合并；完成文件的正常冲突状态不会阻止继续，也不会因此产生覆盖动作。

DirectoryTransfers 在明确暂停或恢复任务持久化时异步准备原生收据快照，未改变的已准备快照可复用，下一条目开始时失效。TaskRuntime 等待准备完成并核对任务 generation；保存期间仍拒绝新授权。已知源/目标/完成收据变化返回明确失败，未知在途目录条目仍标记需要资源恢复。原生恢复只消费新选择得到的目录能力，不能依据检查点里的路径自行打开目标。

自动/协作的真实 SFTP 单元集成均验证了新授权前无剩余文件、恢复后只下载剩余文件、已完成文件时间戳不变，以及来源或本地结果改变时不继续。另验证异步快照失败时不写入持久化记录、不允许提前授权、保留暂停任务，并可随后成功保存。最初测试把保存暂停误期望为 paused-human，已按既有的 paused-error/TASK_RECOVERY_SAVING 状态修正，保留失败与不派发断言。

完整回归首次发现既有 DownloadBatchVault 抢占空锁目录的竞态：并发领取可能两者都失败。现先在独立临时目录写好所有者文件，再原子重命名发布锁；活跃所有者仍拒绝抢占，失败/释放只清理自己的所有者文件和空目录。没有抽取通用锁框架。新增 24 轮双竞争者互斥检查，结合原目录批次恢复及新下载恢复 15 项通过。

修复后完整应用组 **462 文件 / 3316 项通过，4 项按既有条件跳过**，日志 `.cache/task-download-directory-application-verified.log`。首次失败保留在 `task-download-directory-application-tests.log`，并发复查/修复分别在 `task-download-directory-storage-recheck.log`、`task-download-directory-lock-tests.log`。类型检查与中文静态键检查通过；唯一新 lint 错误是测试 finally 中直接 throw，已将受限路径清理移入具名函数并专项验证。真实 Windows 重启与最终包证据继续补充，不用单元集成替代桌面验收。

## 真实桌面与最终包证据

最终 Windows 包通过 MCP 启动自动和协作两种“下载目录 → SSH 校验”流程。首次授权限制 4 项操作，停在目录和首个文件完成后；中文恢复窗口显示 **已完成 2 / 3 项**。保存后删除原模板，应用正常退出并重启，由原客户端领取记录，重新选择原下载目录并授权。恢复只下载第二个文件，首个文件时间戳不变；第二文件字节一致，后续真实 SSH 的 sha256sum 返回预期摘要，两种模式最终均显示完成。协作仍逐项批准新预览/确认/条目。

最终证据目录 `.cache/desktop-observation-report-a47bca7d-5d02-4647-afee-fe1201af934e`，逐场景结果在 `restore/directory-recovery-result.json`。saveShellReconfirmations 和 restoreShellReconfirmations 在两个模式下均为 0，此次成功运行未触发额外的 Shell 重新确认。中文保存窗口截图已查看。4 份实际任务记录验证 TTR1 加密头与测试明文标记不出现，见 `.cache/task-download-directory-encryption.json`；MCP 的保存详情未包含本地目标路径。

独立真实 ConPTY 组 **10 项通过**；最终包原生探针验证 13 项依赖，打包 MCP/隔离 Codex **2 文件 / 3 项通过**，工具数仍为 38。完整 lint 已重新通过，保留既有警告；新增锁测试类型检查通过。类型、前后端构建、中文键检查和 Windows 目录包通过。未使用外部模型或业务服务器。

主要日志：`task-download-directory-application-verified.log`、`task-download-directory-terminal-tests.log`、`task-download-directory-lint-verified.log`、`task-download-directory-final-types.log`、`task-download-directory-build.log`、`task-download-directory-package.log`、`task-download-directory-desktop-reviewed.log`、`task-download-directory-native-probe.log`、`task-download-directory-packaged-mcp.log`，均在 `.cache`。

## 保留的失败与范围

前两次 ConPTY 桌面运行分别在首次授权、重启后授权时复现已记录的首字符丢失：SSH 输入完整 if，Bash 收到 f 并报语法错误，应用以 SHELL_CONTEXT_TIMEOUT 停止。证据目录分别为 `.cache/desktop-observation-report-56474367-4a80-494d-95f1-904f1062e16f` 与 `.cache/desktop-observation-report-33ec23a2-4478-4689-81e9-65fa49abc05b`。没有过滤输入或绕过探测。补充 winpty 后端未通过，且其退出码处理与夹具不匹配；不计为通过证据。最小焦点事件实验未复现丢字符，不能据此宣布找到根因。

桌面脚本随后增加了严格条件下模拟人工核对提示符并重新授权的记录入口，但最终成功运行计数为 0，因此该额外恢复路径未被此次成功运行覆盖。成功不代表 ConPTY/Windows Bash 兼容风险已解决，仍按第 32 份文档保留。未检测到当前可用的本机 Linux 发行版，也未自行启用或安装 WSL。

上传和下载目录的完整条目边界现均已接入任务恢复。部分文件传输资源、独立目录批次协调器和内置 AI 父任务目录恢复的专门桌面组合仍需继续；更广的 Linux/OpenSSH 权限、断线、压力与磁盘故障矩阵未完成。在线升级正在第 46 阶段复核数据保留断言。完整 F/B/R/A 目标保持进行中。
