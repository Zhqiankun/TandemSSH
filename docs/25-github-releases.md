# GitHub 仓库、版本检测与在线更新

2026-09-08，实施中。用户明确要求新建个人 GitHub 项目，并参考 codexBackground 的在线更新与推送触发 Actions。

已创建公开仓库 https://github.com/Zhqiankun/TandemSSH ，本地 origin 已关联。参考目录 E:/codex-project/codexBackground/codexStyle 对应 Zhqiankun/codexDream；采用相同的 GitHub Release、electron-updater、安装标记与固定版本资源清单思路。

主进程 update-service.cjs 拥有版本状态、固定源、更新清单验证、下载取消与安装；update-ipc.cjs 校验主窗口并处理人工安装确认。界面 UpdateCenter 只编排中文状态与按钮，不接受可配置任意更新地址。安装版下载完成后由用户点击安装；免安装版可检查版本并打开发布页。

普通分支推送和 PR 运行 CI；稳定版本标签 vX.Y.Z 触发 Windows x64 的 NSIS/ZIP 构建及 Release。标签必须与 app/package.json 相同。先上传安装包、blockmap 和校验和，最后上传 latest.yml 并发布草稿；同版本已公开 Release 不覆盖，较旧版本不能覆盖最新更新渠道。

当前版本仍为开发预览。创建源码仓库不代表原始完整功能已经通过最终验收；未发布安装包时客户端应显示“尚未发布可更新的安装包”，不能显示已是最新版。Windows 首次安装及真实旧版到新版的升级仍需实际构建与验证。

## 构建与推送约定

源码位于 app，Actions 从仓库根目录的 .github/workflows 启动，npm 命令在 app 内执行。使用 Node.js 24.20.0 与锁文件安装依赖；CI 检查类型、模式、lint、中文键、完整测试及前后端构建。

发布前在 app 内执行 npm version X.Y.Z --no-git-tag-version，提交 package.json、package-lock.json 与该版本源码，再推送相同的 vX.Y.Z 标签。发布工作流不会把普通开发推送自动标记为稳定发行版。公开后的同版本不覆盖；Release 构建保留原生模块重编译，不能把 npmRebuild=false 的本地检查包冒充标准安装发行包。

更新依赖 electron-updater 6.8.9，与参考项目一致。清单校验固定仓库、版本化安装包地址、SHA-512 和体积范围；库负责实际下载校验。普通退出不自动安装。参考 [electron-builder 更新文档](https://www.electron.build/docs/features/auto-update/)；现有实现及参数也已对照已安装依赖源码核对。

根 LICENSE 为完整 Apache-2.0，原始 Termix 版权保留在 app/LICENSE 和 app/UPSTREAM.md，修改说明见根 NOTICE。参考项目仅提供发布方式借鉴，未将其更新源或产品身份复制为本项目配置。

## 当前验证证据

更新服务专项覆盖固定来源、安装包与 SHA-512 元数据、显式下载、取消、重复请求、安装门槛和首次无发行版错误。Windows 验证包中的真实仪表盘显示“检查更新 / 更新版本”，打开中文面板后能显示当前 0.1.0-alpha.0 版本和本仓库尚未发布安装包的真实状态；截图 .cache/release-preview-update.png，UI 观察记录 .cache/release-preview-ui-result.json。

完整测试为 397 文件 / 2950 项通过，5 项跳过；首次完整检查发现五个旧 i18n mock 未保留初始化导出，修正后再把两个旧英文标题期望更新为实际默认中文，未跳过失败测试。类型、前后端构建、中文键与工作流 YAML 解析通过。全库 lint 0 错误、102 警告。当前 Windows 窗口来自 npmRebuild=false 的检查包；尚不能据此宣称标准 NSIS 构建、发布后的完整安装升级已通过。GitHub 首推后的实际 Actions 结果另行记录。

## 首次云端检查与修复

首次提交 750c437 已推送并触发 CI 34179518306。干净环境发现新增队列测试的返回值推断过宽；补充 Promise<DownloadSource> 后本地类型检查通过。npm 11 的依赖安装脚本默认拦截需要显式策略，现已通过 npm install-scripts approve 为六个已核对的当前版本写入 allowScripts，未启用任意后续版本的全局放行。

官方 npm audit 报告的 xmldom、browserslist、fast-uri 与 qs 问题已更新至对应修复版本，复查报告为 0 项。普通推送的 CI 增加 Windows 安装包预览产物，使用带 MSVC Spectre 库的 windows-2022 镜像并保留检查；不禁用缓解配置、不把本地跳过重编译的包作为正式结果。[镜像组件清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md) 是选择依据，实际原生编译仍以 Actions 运行结果为准。

真实隔离桌面再次通过原生更新 IPC 等待完整检查，568 ms 返回 UPDATE_NOT_PUBLISHED；按钮恢复可用后的截图为 .cache/release-preview-update-ready.png，结果记录 .cache/release-preview-live-check.json。启动检测到新版本后现在会显示可点击提示，下载与安装仍由人工触发。

第二次 CI 34180739288 已通过依赖、类型、模式、lint 和中文键，完整测试暴露系统 ConPTY 对 OSC 与长行回显的重排差异，以及上传测试的大块逐元素断言超时。没有修改命令结果断言或跳过自动/协作用例。Windows 本地终端和对应夹具改用 node-pty 随包锁定的 ConPTY 运行库，并补齐原生重编译后的 DLL 复制；长路径下本机全部 10 项真实 PTY 测试通过，云端复测继续。上传断言改为完整 Buffer.equals 字节比较。发布另增加标签、包版本与实际提交三者一致校验，3 项测试通过。

第三次 CI 34182604022 中，输出污染与上传超时已消失，仅两个旧流程等待断言失败。已校验并读取对应轨迹 ZIP 的 SHA-256；两个输出在使用真实预期命令、逐字符输入时均能解码为退出码 0，目录和参数字节完全一致。旧测试等待 5 秒，小于夹具执行器的 10 秒期限。测试观察范围现在按每步期限与串行步数设置，生产期限不变，并额外要求三个操作逐项 succeeded；新增帧与失败时刻记录用于云端复核。相关旧流程本机 3 项通过。

新增打包后原生探针，使用实际 TandemSSH.exe 加载并运行 SQLite、凭据库和串口绑定，以及随包 ConPTY。当前目录检查包在独立探针中通过四项原生检查（Electron 43.2.0 / ABI 148）；目录包缺少安装器的 app-update.yml，因此不视为完整安装包通过。CI 与 Release 均需在生成安装包后执行完整探针，并验证实际更新配置的固定来源。原生运行库文件复制与替换目录防护 4 项测试通过。

## 2026-09-08 最新云端构建通过与交付差距

当前提交 ca55f710130357ed5ebf8e6f8f09d030fa6f9f0f 的 [CI 34185808608](https://github.com/Zhqiankun/TandemSSH/actions/runs/34185808608) 已完成且结论为 success。完整测试 400 个文件通过、2959 项通过、3 项跳过；类型、模式、lint、中文键、前后端构建均通过。测试数量包含底座用例，不能直接换算为产品验收完成率。

Windows 构建保留 Spectre 检查与标准原生重编译，成功生成 TandemSSH-0.1.0-alpha.0-x64.exe 和 ZIP 预览包。打包后的实际可执行文件通过 SQLite、串口绑定、系统凭据库加载及随包 ConPTY 检查，校验了 13 个运行依赖与指向本仓库的实际更新配置。产物 TandemSSH-Windows-preview（artifact 10040713735）已上传，SHA-256 为 fcb9e412bebb0ee7387c734799387c0d14da52f8060de76d4a30a56e7c4f615f；该摘要属于 Actions 产物 ZIP，不是其中安装程序的摘要。

因此标准 Windows 原生编译和安装包生成门槛现已通过；上述历史段落的未通过状态保留为当时记录。尚未完成真实安装、卸载及旧版本到新版本的在线升级；没有发布稳定版本标签或正式 Release。当前交付状态是可运行、可打包的开发预览版，完整 F01—F15、B01—B16、R01—R11 和 A01—A37 目标保持不变。

剩余工作分为六组（每组包含多项实现与验收，不代表六个小修复）：

1. 完整文件传输：递归目录、批量冲突、跨目录另存、应用重启后的检查点恢复。
2. AI/MCP 文件传输与文件流程步骤：上传 → 执行命令 → 下载，以及相应的本地文件授权。
3. 数据与凭据：历史查询、加密草稿恢复、备份恢复、统一系统凭据存储。
4. 连接与基础功能：完整认证和跳板兼容性、监控与隧道统一权限及资源回收。
5. 安装与升级：首次安装、卸载、真实跨版本在线升级，以及正式发布验证。
6. 完整验收：剩余中文界面、Linux/OpenSSH 权限和断线矩阵、压力与接管延迟、许可证清单，以及全套真实桌面场景。

目前没有需要用户补充产品决策的阻塞项。下一步验证安装与升级链路，再继续补齐文件传输和 AI/MCP 文件流程；以上未完成项不因仓库公开或 CI 通过而省略。

## 安装与卸载的实际验收入口

新增 scripts/verify-windows-installation.ps1，负责隔离安装目录、当前用户注册信息、快捷方式、安装标记、可执行文件摘要、卸载与用户数据保留。脚本仅接受 GitHub 托管 Windows runner，已有同名安装或数据时拒绝运行。卸载前再次检查归属与重解析点，不在本机开发环境执行安装。

scripts/verify-installed-desktop.cjs 只负责启动本次安装的可执行文件，核对 PID、程序路径、数据路径与版本；通过实际桌面检查简体中文、数据库就绪、更新按钮和 installed 状态，并验证正常退出释放后端端口。原生依赖验证复用 verify-native-package.cjs。应用业务模块不依赖这些验收脚本。

CI 和 Release 均增加实际安装/启动/卸载门槛，报告与中文窗口截图保存在 TandemSSH-installation-evidence 产物中。PowerShell/Node 语法、非 CI 环境拒绝执行与工作流解析已在本机核对；实际 runner 结果待运行。此检查不代替跨版本在线升级、全部文件功能或自动/协同最终验收。

安装验收首次 CI 为 [34188486997](https://github.com/Zhqiankun/TandemSSH/actions/runs/34188486997)。构建与原生探针通过，安装前读取注册表空条目触发严格模式错误；尚未调用安装程序，因此没有安装报告或截图，失败证据保留在 job 日志。现改为判空并按名称索引属性，实际只读枚举与 scripts/windows-installation.test.ts 的 2 项回归通过。后续复测不得沿用前一轮构建通过来宣称安装升级已通过。

第三次安装链路推进：CI [34189826861](https://github.com/Zhqiankun/TandemSSH/actions/runs/34189826861) 已实际通过安装、版本/快捷方式/标记核对、已安装程序的原生模块检查及卸载。安装证据 ZIP（artifact 10042130324）的 SHA-256 已核对为 af472a8083b84c8a3a3648f08c07496c4a861cfbd6aa949aadc3316b8d15a990。桌面探针在身份读取前遇到 Inspector 的 Promise was collected，未完成桌面与用户数据保留验收；报告中的 dataPreserved=false 表示未验证，不能解释为已证明数据被删除。

探针现在等待 app.isReady() 后读取身份，同步表达式不启用 Promise 等待。另一次真实本机启动暴露首次使用向导挡住更新面板的观察问题，现按实际界面点击“跳过设置”再检查更新；失败报告补充具体阶段和窗口状态。隔离开发包已完成首次向导、中文首页、版本/更新源面板及正常退出和端口释放（.cache/local-startup-observer.log 与当前 local-startup-observer-run.json 所指报告目录）。开发包 installed=false 与预期一致；此观察验证仍不替代 CI 安装版的数据保留与真实跨版本升级。

## 安装验收通过

提交 49a533cc3f2d57bd35ac20d8c775120cd151b99f 的 [CI 34192353445](https://github.com/Zhqiankun/TandemSSH/actions/runs/34192353445) 全部通过。完整测试 401 个文件、2969 项通过、3 项跳过。实际 NSIS 安装、版本/标记/快捷方式、已安装程序的原生依赖、中文首次向导/首页/更新面板、正常退出与端口释放、卸载和加密数据库/验证文件摘要保留均通过。

安装证据 artifact 10042976204 的 ZIP SHA-256 为 67c21cd9187d6eb72f6414ab6fde38226e743d4a8ab3d3b25dc45a4fc282a886，已下载校验至 .cache/installer-passed-evidence.zip。installation.json 中 installed/native/desktop/uninstalled/dataPreserved 均为 true，failures 为空；实际安装版 desktop.json 为 installed=true，更新来源为本仓库，中文截图已查看。用户数据检查覆盖本次初始化的加密数据库与验证文件，不等于未保存草稿或进行中任务的跨版本恢复已验收。真实跨版本在线升级、正式 Release 和完整产品验收仍在后续范围。

桌面目录验收中观察到 electron-updater 默认日志会输出未发布版本请求的原始 HTTP 响应头。现关闭库的原始 logger，版本状态和错误仍经 UpdateService 的脱敏错误码反馈；更新专项 6 项回归通过。

## 真实更新库下载验证

第 46 阶段已补充真实 NsisUpdater / GenericProvider / 摘要流的回环 HTTP 集成测试，版本比较、显式下载、逐字节校验、损坏拒绝、取消后重试及不自动安装共与既有更新服务组合 9 项通过。测试只改写测试进程的 HTTP 传输，产品固定 GitHub 更新源不变。真实两个版本的安装/升级和已发布渠道验收仍未完成，见 [在线更新验收](46-online-update-acceptance.md)。

真实 NSIS 跨版本升级现已接入隔离安装验收脚本，沿用正式更新服务与原生人工确认，在独立 fixture 中观察新版自动启动和数据保留。实现与本机打包/脚本验证见 [第 46 份文档](46-online-update-acceptance.md)；真实云端运行结果尚待确认，不将脚本实现视为升级已验收。

## 实际跨版本安装链路通过

2026-09-10，提交 cd933c9 的 CI 34372828543 已成功。实际测试包 0.1.0-alpha.0 → 0.1.1 完成检查、下载校验、取消/确认安装、新版自动启动、数据库流程记录/文件/界面数据保留、正常退出与卸载；所有安装证据布尔项为 true，failures 为空。证据摘要、截图及精确范围见 [第 46 份文档](46-online-update-acceptance.md)。

这是隔离 runner 中真实 NSIS 与真实更新服务的包版本升级验证，更新内容由回环测试源提供；正式 GitHub Release 渠道和全部历史数据迁移矩阵仍未发布/验收，不将测试 fixture 当作公开版本。
