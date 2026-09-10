# Windows 本机文件属性

状态：已实现并通过 Windows 实机专项，完整回归与提交结果见下文。属于原始 B04/B10 的本机浏览补齐，不改变自动、协作和 MCP 的任务权限。

`electron/windows-file-attributes.cjs` 负责一次目录列表的 Windows 属性读取；通过系统 PowerShell 和固定的只读 .NET `File.GetAttributes` 代码批量获取 Hidden、System、ReadOnly 等标志。固定代码作为程序的一部分打包，目录和文件名仅经 JSON 标准输入传递，不插入命令文本，不运行用户脚本，不修改 PowerShell 执行策略。文件内容不被读取。

`LocalFileBrowser` 继续拥有目录选择和路径/身份检查；先枚举当前已授权目录，再把最多 10,000 个直接子项交给属性读取器，最终复核目录身份。进程窗口隐藏，输入/输出有上限，超时或面板释放会终止本次属性读取进程。IPC 只返回目录 DTO，不向 renderer 暴露进程启动接口。

新属性字段是可选 DTO，保留旧调用方兼容性：每项可包含 `system`、`readOnly`、`attributesKnown`；页面可包含 `attributeWarning`。默认隐藏点文件、Hidden 和 System 项，勾选后显示。只读属性用于展示，不能等同于完整 ACL 写权限判断，也不自动清除属性。

Windows 读取器不可用或某项读取失败时，保留可读取的文件列表并提示属性信息不完整；未知项不被当作已经确认的普通文件。非 Windows 继续沿用点文件行为。目录能力、上传来源、下载目标的独立生命周期保持不变。

主智能体负责所有模块。依赖方向：目录用例 → Windows 属性适配器 → 固定系统 API；UI → 类型契约/已有目录 API。后端任务、AI、MCP 不依赖此适配器，不增加通用 helpers 或新的第三方运行时。

验收：真实 Windows Hidden/System/ReadOnly 文件及目录、中文/引号/美元符号文件名、筛选/显示/刷新、错误/超时/取消与进程释放；原生隔离目录测试与中文 UI 测试；打包后实际双面板及双向传输回归。不得只靠设置模拟位掩码就声称 Windows 实机行为已通过。

参考：[File.GetAttributes](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.getattributes)、[FileAttributes](https://learn.microsoft.com/zh-cn/dotnet/api/system.io.fileattributes)。

## 已实现与验证（2026-09-10）

固定的只读脚本存放于 `electron/windows-file-attributes.ps1`，由属性适配器读取为固定程序文本；打包后从 ASAR 读取文本，再调用 Windows 系统目录中的 PowerShell，实际执行文件不位于 ASAR 内。一次最多处理 10,000 个直接子项，JSON 输入最多 4 MiB，标准输出最多 256 KiB，错误输出最多 16 KiB，执行上限 15 秒。取消、超时或超限时只终止该固定脚本的子进程，等关闭事件后完成请求。

`LocalFileBrowser` 为每个浏览根持有取消信号。读取属性前后仍使用原来的身份和路径校验，释放/重置根时中止属性读取。Windows 属性失败不会把“未知”当成已经确认的普通文件：对应项显示属性不可用，列表提示可能包含隐藏/系统项；非 Windows 不显示此 Windows 专属提示。

专项结果：3 个文件、25 项通过。除了输入/输出契约、超时、取消和窗口能力测试，还通过 `attrib.exe` 对项目临时目录内的真实文件和文件夹设置 Hidden、System、ReadOnly，用产品读取器核对实际位标志；覆盖中文、引号、美元符号、单文件返回、刷新后的可见性和文件字节不变。另启动实际 Windows 属性读取进程并取消，确认在子进程关闭后返回取消结果。中文面板测试覆盖开关、属性提示及属性信息不完整时的文字。

完整类型检查、前后端构建和 Windows 本地解包构建通过；lint 为 0 个错误、100 个既有警告，没有新增警告。初始回归的 12 项和新增后的 25 项均通过，未调整既有用例的断言或超时。

实际桌面验证：默认不显示真实 Hidden 文件、System 文件和 Hidden 目录；只读文件默认可见。打开“显示隐藏/系统项”后全部出现，选中只读文件后中文属性栏显示“只读属性”；再次关闭开关后隐藏/系统项消失，没有属性读取失败提示。随后真实回环 SSH/SFTP 上传 8,388,621 字节、下载 8,388,625 字节，逐字节核对一致；确认前不写入/覆盖，处理中关闭本机面板后仍完成。测试应用正常退出，测试文件属性已恢复。

桌面目录选择器仍采用 [双面板验收](58-local-remote-file-panels.md) 的隔离方式：仅在核实身份的测试应用主进程替换为固定测试目录；产品 IPC、文件读取、Windows 属性读取器、预览、队列和 SSH/SFTP 实际运行。此结果不是业务服务器或原生目录选择器的人工验收。

本机证据：`.cache/windows-attributes-tests-final.log`、`windows-attributes-lint.log`、`windows-attributes-types.log`、`windows-attributes-build.log`、`windows-attributes-package.log`、`windows-attributes-desktop.log`。成功报告位于 `.cache/desktop-observation-report-45ee9fd3-0d50-4465-9e77-01d077bc6960`，包含 `windows-attributes-default.png`、`windows-attributes-visible.png` 和 `windows-attributes-result.json`。缓存、配置、测试文件均不提交到 Git。

只读属性是文件标志，不是完整 Windows ACL 判断；本功能不会修改用户文件属性，也不会自动提升权限。Windows PowerShell 不可用时按前述规则明确降级。原始整体产品验收、其他认证组合、性能与发布要求继续保留。

## 全量回归中的测试夹具修复

首轮完整应用回归有 1 项失败：`compression-config.test.ts` 的普通响应测试报 `fetch failed / bad port`，请求未到达压缩中间件。夹具使用 `listen(0)`，当前 Windows 分配范围可能包含 Fetch 禁止使用的服务端口。已核对所安装 Fetch 实现的禁止端口列表。

仅修改该测试的服务监听方式：从 49152—65535 选择空闲端口，遇到占用最多重选 10 次，监听错误正常返回。原来的 gzip、普通响应、SSE、二进制流和压缩率断言全部保留，产品压缩代码和 Fetch 的限制不变。该文件 7 项独立复测通过，随后重新运行完整应用回归。失败与复测记录分别为 `.cache/windows-attributes-regression.log` 和 `windows-attributes-compression-recheck.log`。

上一批双面板提交 `cb2a5f8` 的 GitHub CI `34427500860` 已完成并通过；该结果不代替本批尚未提交改动的远端验证。

## 最终应用回归

修复测试端口后重新运行完整应用套件：482 个测试文件通过、1 个文件按环境跳过；3458 项通过、13 项条件跳过。命令为 `vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2`，日志为 `.cache/windows-attributes-regression-final.log`。Windows PTY 保持既有独立 CI 门槛；未提供 Linux 清单时真实 Linux 用例按条件跳过，不把跳过称作 Linux 实机通过。

最后的安装包检查也通过：13 项原生依赖探测、3 项打包 MCP/Codex 初始化测试；中文静态键缺失 0 项，最终 lint 0 错误、100 个既有警告。证据为 `.cache/windows-attributes-native-probe.log`、`windows-attributes-packaged-mcp.log`、`windows-attributes-lint-final.log`。Codex 检查仅使用隔离配置进行握手和工具发现，没有模型请求或日常配置变更。

测试端口夹具修复单独提交为 `10ecbe7`，Windows 文件属性实现单独提交；完整产品目标继续进行中。
