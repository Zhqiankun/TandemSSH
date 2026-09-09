# 下载批次跨重启恢复

2026-09-09。人工目录/多选下载批次已接入中文保存与恢复入口、系统加密记录、重新核验与暂停后继续。本文记录人工下载批次这一项交付；AI/MCP/流程跨重启执行及原始全量验收继续实施。

## 用户行为

下载队列提供“保存整批下载进度”。保存会先停止批次继续调度，等待在途文件收敛，保留目录计划、完成结果和部分文件；持久化成功后释放旧队列。保存失败保留暂停队列，可重试保存或继续下载。

“查看可恢复下载批次”在空队列和有任务时都可打开。窗口显示服务器、本地目标、逐项结果和原清单，按 50 项分页。恢复前重新确认原计划及必要的覆盖，选择原目标文件夹，核验服务器公钥、来源、目录身份、已完成文件收据和部分文件。恢复到队列后保持暂停，点击“继续整批下载”才执行剩余项目。已完成文件保留原结果，不重新下载。

未知提交单独显示，通过“核对本地完成结果”检查，未核对成功不自动重复写入。取消批次记录未执行项目和部分文件的实际取消结果；放弃已保存下载需要第二次明确操作，仅清理本批次部分文件，保留已完成文件与目录。已结束记录可以移除。

## 模块责任和依赖

主智能体独立负责本轮设计、实现和验证。依赖方向为中文界面 → 人工 HTTP 票据与原生 IPC → 批次协调器 → 来源树/文件传输/原生目录与加密存储公开入口。没有增加另一套下载器或通用共享抽象。

- DownloadBatchRecoveryDialog.tsx 负责原计划审阅、恢复/核对/放弃交互，DownloadQueuePanel.tsx 负责批次按钮和状态反馈。中英文文案位于原有 locale 文件。
- download-batch-recovery-api.ts 只提交用户意图和已有能力 ID。恢复前先预留队列容量，目录选择取消或核验失败会释放预留与未使用的原生选择。
- DownloadBatches 拥有批次状态、目录执行、暂停交接和恢复队列编排；DownloadQueue 拥有并发、分块执行与逐项生命周期。保存期间冻结成员操作，窗口/账户撤销时交给原生恢复持有者保留数据。
- download-batch-recovery-production.ts、download-transfer-routes.ts 与 starter.ts 接入实际服务与私有桥。票据绑定真实用户、窗口、来源集合和新会话；页面不能自行提交可信来源检查点。
- download-batch-rpc.cjs 负责私有后台请求、响应关联、超时和断开清理。download-batch-recovery-controller.cjs 负责一次性领取、保存/恢复事务、新成员登记、提交状态、取消/关闭顺序及完成核对。
- DownloadDirectoryTargets 负责根目录/父目录身份、原计划、新成员绑定、目录结果和完成收据；DownloadSink 继续负责唯一的分块落盘和完整性校验实现。
- DownloadBatchVault/Record 负责按用户隔离的系统加密记录、独占写入/领取和格式校验，每条最多 32 MiB、每用户 8 条/256 MiB，不回退明文。核心来自前一提交 29d9025，生产接线与中文入口在本轮完成。

## 持久化和撤销契约

1. 首次保存使用 suspendBatch 持有全部暂停文件，目录与文件检查点一次写入成功后才释放旧能力；失败不删除原暂停文件。
2. 恢复后的新文件在发送下一块前持久化本地检查点；最终提交前记录 committing 并核对后台来源已验证。提交失败保留待核对状态。
3. 窗口 reset 先于旧目录/文件清理。先拒绝旧作用域，等待已登记工作，同步确认偏移并保留部分文件，再释放旧来源。未持久化成功不伪报可恢复。
4. 完成回调支持队列重复确认，完成文件保存摘要和属性收据；核对成功更新逐项状态并释放旧原生文件能力。仅目录结果未确定时，核对完也会结束整个批次。
5. 显式取消与窗口撤销分开处理：显式取消清理自己创建的部分文件并记录取消，撤销保留已恢复文件给持久化持有者。未知结果不按普通取消删除。

## 实际验证

相关完整回归 **112 文件 / 734 项通过**，覆盖文件传输、自动执行、人机协作、流程与 MCP。后续补充“已完成同批文件不重写”和“仅目录待核对时结束批次”两个实际文件场景，最终协调器与中文界面专项 **2 文件 / 12 项通过**。没有用 UI mock 替代原生/SFTP 检查：协调器测试实际运行回环 SSH/SFTP、私有消息桥和本地文件；UI 测试另行检查确认、容量预留、失败保留、原生选择取消和未知结果操作。

类型检查、改动模块 lint、前后端构建通过；缺失字面翻译键 0，中英文相关 2 文件 / 6 项通过。Windows 包内探针验证 13 项依赖和目录恢复能力，打包 MCP/隔离 Codex 2 文件 / 3 项通过。打包使用已经与 Electron checksums.json 核对的本机 ZIP 和 npmRebuild=false，正式 Actions 配置不变。上一提交 29d9025 的 CI 34324511910 成功。

实际 Windows 桌面使用隔离用户目录和真实回环 SFTP：下载两个文件与两个目录，运行中保存 **8,388,608 字节**大文件前缀，正常退出重启后恢复为暂停；对这个测试实例执行进程树中断，再次启动恢复并主动继续，最终 **4 / 4 项完成**，大文件 **12,583,025 字节**，SHA-256 为 f59aa3b97eaa737189aa75f35294e7d6df38a6a0620dae47d73fe2629bddce58。部分文件记录检查未包含来源路径或本地目标的明文，首末两次应用正常退出，测试中间的强制中断单独记录。

证据目录：.cache/desktop-observation-report-3f8f26c7-96fc-41b8-8f8f-da93b28cf8f9。已检查恢复后截图，中文窗口显示 4 / 4 项、暂停 0、待核对 0。首轮脚本把目录菜单写成单文件下载标签而超时，现场保留；修正为实际“下载目录”菜单后完整通过。应用未为通过测试改变菜单或下载行为。

日志：download-batch-ui-regression.log、download-batch-ui-types-final.log、download-batch-ui-lint.log、download-batch-ui-build.log、download-batch-ui-localization.log、download-batch-ui-native-probe.log、download-batch-ui-packaged-mcp.log、download-batch-recovery-desktop-first.log、download-batch-recovery-desktop-second.log、download-batch-completed-sibling.log、download-batch-ui-final-edge-tests.log（均在 .cache）。

## 验证边界与剩余工作

本轮桌面中断发生在恢复到暂停队列后，证明已保存部分文件跨异常进程退出保留；不把它等同于所有传输块/提交时刻的掉电测试。加密组件集成测试使用测试密钥，实际桌面另行验证系统加密。磁盘故障、并发关闭、未知提交和目录替换的更广故障矩阵仍需补齐。

AI/MCP/流程跨重启执行、SSH 认证/跳板与其他基础能力完整矩阵、实际跨版本在线更新以及 F01–F15/B01–B16/R01–R11/A01–A37 总验收继续。自动执行、人机协作、随时接管及 Codex MCP 仍是整体交付标准，Goal 未完成。

最终包已纳入目录核对结束状态修复，三阶段桌面验收再次全部通过：.cache/desktop-observation-report-8e849c6a-a6d4-4ed3-a9df-ef5029f21bbb。保存前缀 8388608 字节，最终 12583025 字节与相同 SHA-256 一致。最终包原生探针与打包 MCP/隔离 Codex 3 项通过，最终 lint 通过。日志 download-batch-recovery-desktop-final.log、download-batch-ui-package-final.log、download-batch-ui-packaged-mcp-final.log、download-batch-ui-lint-final.log。
