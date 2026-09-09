# 目录批次跨重启恢复

状态：2026-09-09 开始实施。完整目标包含人工目录上传/下载及 AI、MCP、保存流程的跨重启续跑，不能以单文件恢复或只读历史替代。

## 实施边界与文件责任

主智能体负责设计、实现和验证。上传/下载 TreeService 继续拥有固定清单、远端身份、路径约束和目录结果；对应 tree-checkpoint 文件只校验内部保存格式。恢复仅由以后接入的已认证、已解密协调器调用，不新增接受任意检查点的 HTTP/MCP 接口。

上传清单恢复后生成新的树 ID 与预览版本，清除原确认动作；已成功创建/合并目录保留核验结果，未知目录结果不能因跳过或取消被改写成成功。新文件和覆盖写入仍走原 UploadService 的目标基线与接管检查，不能复制分块上传。

下载清单恢复保持原条目 ID 和集合，不重新枚举新增文件。核对原主机公钥、规范路径及目录属性；文件仍通过原 DownloadService 在准备和读取时校验属性及摘要。清单属性快照不等于所有未准备文件的内容快照。

随后由批次协调器组合目录检查点、每个文件的完成收据/暂停检查点、本地目录能力和加密记录；原生能力必须由用户重新选择目录后核验，旧能力 ID、写入锁和批准不可恢复。已完成条目核验后保留，不重新传输；待执行条目继续原队列，未知结果先核对。人工入口完成后，AI/MCP/流程恢复还必须经过新任务授权、预算与控制权。

依赖方向：中文界面/模型适配 → 恢复协调器 → 目录/单文件公开用例 → SSH/SFTP 或原生文件能力。页面不读加密文件，恢复数据不含密码、私钥或模型 Key，不创建新的通用业务层。

## 验收场景和验证方式

- 新实例和新 SSH 连接恢复固定清单，包含空目录、中文名称和已创建目录；恢复自身无远端写入，继续仅完成剩余项。
- 用户、公钥、根路径、父目录变化拒绝；文件变化不能盲目继续。来源新增条目不会加入原批次。
- 持久化失败保留原预览；恢复中取消或 dispose 不复活记录，沿用原全局/用户容量限制。
- 未知目录创建在恢复/跳过后仍未知；原覆盖和合并确认不能沿用。
- 真实 SFTP、原生文件系统、队列、中文界面及实际 Windows 正常重启/中断分别取得证据；AI/MCP/流程另测自动和协作模式。

本轮命令采用 app 中既有 vitest、tsc、eslint 和构建入口。核心先跑目录恢复专项及原目录/上传/下载/自动化回归，再按修改范围验证打包与实际桌面。失败记录包括复现、远端副作用、修复与复测；最终报告区分核心、产品入口和完整验收。

## 本轮已实现：四端检查点与重新授权核心

远端上传/下载清单分别新增 upload-tree-checkpoint.ts、download-tree-checkpoint.ts，TreeService 暴露内部 checkpoint/restore。上传保留路径基线和目录结果，恢复后返回新的 preview/revision 并清除原确认动作；下载保存原主机身份与固定成员，在新连接核对原路径及属性，不重新枚举来源。容量限制、取消/dispose 和引用释放继续由原服务维护。

原生上传来源新增 upload-source-checkpoint.cjs。恢复必须提供用户刚选择的来源能力，核对根集合、文件身份/版本并映射回原成员 ID；新添文件不会进入旧批次，旧选择能力被消费。该方法不从恢复数据自行打开本地路径，后续每次块读取仍执行原文件及父目录检查。

原生下载目标新增 download-directory-checkpoint.cjs。保存清单前要求暂停成员已通过 DownloadSink 完成检查点交接，拒绝仍活跃的子文件。已完成文件保存核验后的摘要/身份收据；重新选择同一根目录后核对原目录和收据，恢复为未确认预览。attachRestored 将已有暂停文件绑定回精确条目，并复核父目录身份、目标基线、大小、账号及在途状态；最终继续仍走 DownloadSink。已完成文件不可重新绑定或重写。

未知目录创建在恢复后仍保留未知结果；修正了跳过分支会把此前 unknown/created/merged 覆盖为 skipped 的行为。人工明确跳过剩余操作不应抹掉已经发生的目录结果。两个新的原生检查点依赖已加入 asarUnpack，CI 同款包探针会实际加载并检查 checkpoint/restore/attachRestored。

未新增通用业务抽象。检查点 schema 分别归各自目录用例；原生下载复用既有 checkpointStat，分块状态机仍只有 UploadService/DownloadService/DownloadSink。没有新增接受检查点 JSON 的人工 HTTP 或 MCP 工具。

## 本轮验证证据

新增专项 2 文件 / 15 项通过；与原双向目录及原生来源联合 **6 文件 / 45 项通过**。真实 SFTP 用例销毁旧服务并使用新 SSH 连接，验证已创建目录不重复 mkdir、原始块检查点继续上传后字节完整；下载来源新增文件不加入原清单，修改来源在恢复与准备时均拒绝。还覆盖用户/公钥变化、层级非法、根路径变化、原覆盖基线、取消/dispose、容量及未知结果。

真实本地文件用例验证目录重新选择、原文件变更拒绝、已完成文件摘要核对、暂停成员分块恢复并完成，以及完成文件的 inode/mtime 保持不变。最后新增的异步核验后在途状态复查，原生 6 项再次通过。这里证明新实例与新连接的核心能力，尚未执行本轮整批加密记录或真实桌面重启流程，不能借用上一轮单文件桌面截图。

最终相关回归 **106 文件 / 696 项全部通过**，覆盖文件、AI、MCP、流程、自动执行、协作接管和中文工作台。类型、改动模块 lint、前后端构建和 Windows 解包包通过；最终包原生探针确认 13 项依赖、目录恢复入口及 SQLite/串口/系统密钥/ConPTY，打包 stdio/隔离 Codex 3 项通过。本机依然采用 npmRebuild=false 复用已验证原生模块，标准原生编译和实际安装由对应提交的 CI 验证。

首次专项测试错误地要求已准备下载来源立即释放 SSH 引用；实际设计需要保留至完成/取消。调整为检查准备后保留、显式取消后归零，随后专项与完整回归通过，没有改动或放宽生产连接生命周期。

日志：.cache/directory-recovery-core-tests-final.log、.cache/directory-recovery-core-regression.log、.cache/directory-recovery-core-types-final.log、.cache/directory-recovery-core-lint-final.log、.cache/directory-recovery-native-final.log、.cache/directory-recovery-core-build.log、.cache/directory-recovery-core-package.log、.cache/directory-recovery-core-native-probe.log、.cache/directory-recovery-core-packaged-mcp.log。

上一提交 6a08e6e 的 CI 34308161011 已全部成功。

## 下一步保持完整范围

仍需接入批次级生产加密存储、退出保留、窗口及账号占用、中文整批保存/恢复/核对与实际桌面重启验收。已完成上传收据和一次交接的用例已由下节接入；生产持久化协调仍继续。本轮检查点仅为内部格式和用例，尚未对用户开放整批跨重启恢复。随后继续 AI/MCP/保存流程的恢复授权和自动/协作双模式验收；旧权限、能力 ID、预算和确认不能从保存数据复活。

SFTP 的目录属性无法提供原子 inode/CAS；下载清单的文件属性约束也不等于全部未准备来源内容已经固定。真实 Linux/OpenSSH、权限/断线/大批次矩阵与完整 A01–A37 保持待验收，不因本轮局部通过而缩减原目标。


## 2026-09-09 上传完成收据与整批交接

UploadService.completion 只从已验证完成、无临时文件/未知提交的内部记录生成结果，包含本批次及条目归属。UploadTreeService.completeEntry 核对用户、批次来源标识、条目、服务器公钥、规范目标、字节数和来源版本后记录完成结果。同一路径的独立上传不能冒充本批成功，HTTP 仅接收 uploadId，拒绝用户自行提交摘要、API Key 和跨用户请求。重复登记在原上传运行记录已释放后仍返回原收据。

人工 UploadQueue 的托管文件在释放上传记录前调用该接口；自动目录执行器也先登记再释放。记录失败保留已完成事实和运行证据，人工队列显示中文“上传已完成，但批次结果尚未保存”，清理完成项时只重试记录，不重新上传。每个条目单独协调登记，其他文件的准备不会被一个收据写入阻塞。

上传目录检查点包含这些完成结果，恢复时重新核对远端内容；核验成功的完成项保留，确认时不重新派发。批次来源标识用于追踪实际上传归属，不恢复旧授权、控制权或会话。

UploadTreeService.suspend 与 UploadService.suspendBatch 提供组合交接：先固定目录和所有指定成员，再执行一次持久化回调，成功后才释放各运行记录。暂停成员包含确认偏移，未开始预览标为 pending，已有未决提交标为 unknown。持久化期间暂停记录不能被取消、续写或定时清理；正在准备文件或登记收据时不能保存目录快照。持久化失败保留原目录和成员。生产协调器仍须维护持久化占用、写入状态和窗口生命周期，不能直接把回调通过等同于生产恢复入口已完成。

新增 7 项用例，最终专项 3 文件 / 32 项通过；人工队列/真实 SFTP 验证登记失败重试无额外写入，HTTP 验证拒绝越权与伪造摘要，完成收据验证新连接复原及内容变化拒绝。组合交接用例实际把目录与暂停/pending 成员加密写入测试文件、fsync 后释放，在新 SSH 连接继续两项上传并验证全部字节。该加密联测使用注入的测试密钥和持久化回调，尚未接入生产批次记录库。

最终相关回归 **106 文件 / 703 项全部通过**，类型、模块 lint、中文键及构建/Windows 解包通过。最终包原生探针验证 13 项依赖和目录恢复能力，打包 stdio/隔离 Codex 3 项通过。已有 34 项 MCP 工具保持可用。

当前 Windows 包实际完成 automatic/collaborative 两种目录上传 → 共享 SSH 校验上传文件 SHA-256 → 目录下载，均保持 3 个逻辑步骤、13 次成功操作；协作中途接管后续跑没有重复成功条目。最终内容、空目录、空文件、同一 SSH 连接及可复用导出通过，应用正常退出。报告：.cache/desktop-observation-report-60e89bf2-22ac-42b9-80e4-2f4686b6f0dd/workflow-directory-result.json；该目录含完成/授权/接管截图和终端输入输出记录。原生选择器由测试主进程提供专用测试目录，未使用用户服务器或付费模型。

桌面首轮复核在首次终端核对处失败：测试 SSH 收到完整 if 探测，本地 ConPTY/Bash 执行时缺少首字符，应用返回 SHELL_CONTEXT_TIMEOUT 并停止步骤。增加有界终端输出/尺寸记录后复验通过，没有过滤输入或改动应用探测。失败报告 .cache/desktop-observation-report-d18e31bb-77ea-4cab-a9e1-1b068e1960f8 必须保留；便携新版 Bash 仍出现过该现象，不能声称兼容性问题彻底解决，见第 32 份文档。启动器先前的 Windows ESM 文件 URL 错误也已修复，失败日志单独保留，未把启动器失败归因于产品。

证据日志：.cache/upload-batch-handoff-final-tests.log、.cache/upload-batch-handoff-regression.log、.cache/upload-batch-handoff-types-final.log、.cache/upload-batch-handoff-lint-final.log、.cache/upload-batch-handoff-localization.log、.cache/upload-batch-handoff-build.log、.cache/upload-batch-handoff-package.log、.cache/upload-batch-handoff-native-probe.log、.cache/upload-batch-handoff-packaged-mcp.log、.cache/upload-batch-handoff-desktop.log。

上一 ab2ebe4 的 CI 34309966755 已全部成功。本轮生产收据已接入人工和自动目录路径；整批恢复按钮、生产加密记录、跨应用重启的批次恢复及 AI/MCP/流程恢复仍待完成，完整 Goal 保持进行中。
