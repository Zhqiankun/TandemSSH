# 开源底座评估：Termix 与 Tabby

评估日期：2026-09-05。结论：**针对完整 SSH/SFTP 工作台 + 在线编辑 + 命令流程 + AI 协作的需求，优先选择 Termix 做下一步验证；Tabby 为备选。** 本文保留当时的静态选型依据。后续已完成部分 Termix 发布版构建/启动检查，并从固定发布提交导出正式 app 源码开展改造；见[M0 实测报告](11-m0-validation.md)和[实施记录](12-implementation.md)。这不代表完整产品或发行包已验收。

## 1. 评估依据与边界

静态评估阶段检查了官方文档、许可证、包声明和关键实现。GitHub 目录 API 限流后，在临时目录获取浅克隆元数据并只读查看选定文件，该阶段没有导入工作区或执行安装脚本。第 11 份报告另行记录此后固定发布标签的运行验证。

| 项目 | 检查的提交 | 提交日期 | 版本说明 |
| --- | --- | --- | --- |
| Termix | `42f8270c2072f28486503a45fe91719eb5069b42` | 2026-09-02 | 该提交根 package.json 为 2.7.1 |
| Tabby | `14e2d60b9b6dee84a53c37f05eefeb803787de04` | 2026-07-13 | app/package.json 是内部占位版本，不能据此认定正式发布版本 |

这是一轮需求适配和关键源码评估，不是完整代码审计、依赖漏洞扫描或 Windows 构建验收。文档与已发布安装包可能不同，正式选型前需要选定发布版本复核。

## 2. 按用户需求比较

表中“已有”表示找到文档与相应源码入口，不代表本机运行测试通过。

| 你的要求 | Termix | Tabby | 适配判断 |
| --- | --- | --- | --- |
| Windows 桌面、本机使用 | Electron 入口会启动本地后端；有独立桌面模式 | 原生桌面使用形态，Electron 启动脚本 | 两者均可候选，仍需构建实测 |
| SSH、多标签、分屏、主机管理 | 已有综合工作台 | 已有，终端和连接体系更集中 | 两者可复用 |
| 上传下载和目录操作 | 文件工作台、传输引擎、完整 UI 入口 | 内置 SFTP 面板及目录上传下载、重命名等方法 | 不能说 Tabby 没有 SFTP |
| 软件内在线编辑 | 已有 CodeMirror 编辑组件与远端读写接口 | 检查到的核心路径是 Edit locally：临时下载、外部编辑、监视后回传 | Termix 更符合你的使用方式 |
| 传输队列、进度、取消、失败结果 | 有独立状态、取消和完整性校验代码 | 有上传下载抽象；复杂队列/恢复需进一步补齐或核查 | Termix 更接近，暂停续传仍须逐场景验收 |
| 服务器 CPU/内存/磁盘/进程查看 | 已有专门监控工作台 | 本次未找到同等规模内置监控工作台 | Termix 少做一块较大的产品模块 |
| SSH 隧道 | 已有本地/远程/动态转发 | 已有转发模块 | 两者均需接入本项目权限边界 |
| “先 A 后 B”的自定义命令 | 有 snippets、终端宏和自动化执行器 | 快捷命令可通过生态扩展；本次未找到同等核心流程执行器 | Termix 可复用更多界面/定义，执行语义仍需改造 |
| 自带模型 API Key | 已有 provider 适配器和 AI 设置 UI | 本次未找到核心内置的同类 Agent/provider 模块 | Termix 更接近 |
| 人工/协同/自动模式 | 有 AI 提案与批准路径 | 需核心扩展或插件整合 | 两者都未验证满足 TandemSSH 的完整模式 |
| 同会话随时接管/交还 | 有终端共享权限，但 AI 命令走另外的执行路径 | 有会话 API，未找到本项目要求的控制租约 | 两者都要新增/统一控制权机制 |
| 全局/分组/主机/任务黑白名单 | 有 AI 只读命令白名单，但不是全入口可配置策略体系 | 未找到核心同等策略体系 | 两者都需要新增 |
| 执行与文件变更统一记录 | 已有多类记录，可适配 | 需补齐跨模块的结构化事件 | Termix 可复用外围，统一语义仍须实现 |
| 开源许可 | Apache-2.0 | MIT | 均有公开源码许可；需保留上游声明并核查依赖 |
| 技术栈 | React + TypeScript + Electron/Node | Angular + TypeScript + Electron | Termix 与当前 React 候选方案一致 |

## 3. 决定性源码证据

### E01：Termix 桌面不是只能连接远程服务的外壳

`electron/main.cjs` 中有本地数据目录和 backend 启动逻辑，`backendProcess = fork(...)` 启动自身后端。官方独立模式与数据库文档也作了说明。因此不能按较早的 connector 文档断言一定需要额外部署远程服务器。

来源：[桌面入口](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/electron/main.cjs#L874)、[独立模式说明](https://docs.termix.site/setup/remote-sync/)。

### E02：Tabby 有文件传输，但编辑路径与目标体验不同

`tabby-ssh/src/session/sftp.ts` 提供上传、下载、mkdir、rename、chmod 等能力；`sftpPanel.component.ts` 包含文件夹传输。`tabby-electron/src/sftpContextMenu.ts` 的编辑入口下载临时文件并调用本地打开，再通过文件监听上传改动。

这适合配合自己常用的外部编辑器，但要做你要求的内置编辑、草稿、冲突比较与 AI 改动预览，仍需增加完整编辑工作区。

来源：[SFTP](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/sftp.ts)、[编辑入口](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-electron/src/sftpContextMenu.ts#L40)。

### E03：Termix 有宏，但不能直接当成受控部署流程

`terminal-macros.ts` 已定义 send、delay、wait、条件和 repeat，并可发出步骤事件。当前发送路径直接调用 terminal adapter 的 send，因此复用时需要改成统一动作网关，增加策略版本、接管租约、审批、结果可信度和恢复检查。

来源：[宏定义与执行](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/ui/lib/terminal-macros.ts#L90)。

### E04：Termix 的 AI 执行还不是当前 PTY 的可接管控制

AI tool catalog 组合 read/propose 工具；批准的 run-command 经共享 SSH pool 和 execCommand 执行。终端 session-manager 则管理参与者的 read-only/read-write 权限。两种现有能力不能证明“一个输入控制者、接管后旧动作绝不再写入”。

还发现 runCommandOnHost 当前将退出码 null 与 0 都作为无错误结果。TandemSSH 必须按本项目契约区分已知成功与未知，避免把断线或缺少退出状态直接当作部署成功。

来源：[AI 执行器](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/backend/ai/tools/executor.ts)、[终端共享权限](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/backend/hosts/terminal/session-manager.ts#L73)。

### E05：Termix 规则只能作为起点

`command-allowlist.ts` 为选择了只读执行的 AI 提供固定命令集合及解析限制。这不等于用户要求的全局/分组/主机/任务规则，也不能自动约束宏、普通终端、自动化和文件入口。

来源：[AI 命令白名单](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/backend/ai/tools/command-allowlist.ts)。

### E06：在线保存与断点恢复仍有专项工作

Termix 有内置编辑组件、远端内容读写、文件权限恢复、传输取消与完整性检查。当前 writeFile 接口接收 sessionId/path/content，未看到绑定“打开时版本”的必填前置条件；需补本项目定义的草稿基线与提交冲突契约。已有 transfer resume 相关代码也不等于每种暂停/断线/源文件变化情况都能安全恢复。

来源：[编辑器](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/ui/features/file-manager/components/CodeEditor.tsx)、[文件保存接口](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/backend/hosts/file-manager/content-routes.ts#L489)、[传输引擎](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/src/backend/hosts/file-manager/transfer-engine.ts)。

## 4. 推荐复用方案

### 优先复用 Termix 的部分

服务器与分组 UI、人工 SSH 工作台、文件浏览/编辑界面、SFTP 适配与传输展示、监控、隧道、主题/语言、模型配置与 provider 适配、命令片段和宏编辑的合适部分。

### TandemSSH 需要新增或重构的部分

1. 单写入者、控制权版本、接管/交还和断线后重新确认。
2. 所有自动化入口统一动作网关，覆盖 AI、宏/流程、MCP、文件和隧道。
3. 多级可配置黑白名单、规则试算、拒绝优先与过期审批失效。
4. 顺序流程的快照、失败停止、明确重试和恢复位置。
5. 同一目标的命令/文件操作时间线、未知结果和上下文缺口处理。
6. 文件草稿基线、冲突保存、元数据保留与安全恢复。
7. 以本机独立使用为默认路径，关闭无关云同步/公开共享/后台调度，并验证禁用是真正不执行。

不把 Termix、Tabby、ssh-mcp-server 三套完整执行后端拼在一起。主底座只选一个，其他项目仅按边界复用必要模块，避免多套凭据库、SSH 会话和权限规则相互绕过。

## 5. 改造成本与风险

Termix 的基础产品补齐量较小，执行与权限收敛工作较大。它已经是综合平台，不应假设轻量或几处修改即可达标；例如本次读到的 main.cjs 和 transfer-engine.ts 都超过三千行，必须逐步改动并保持可观察基线。

Tabby 的桌面终端基础值得复用，但要增加内置文件编辑、监控、流程、AI 设置/工具循环和统一记录等更多产品模块；与原 React 提案也不同，不能 fork 后无理由重写为 React。

两者都有构建链和原生依赖，Windows 打包难度不能仅凭截图判断。开源、星数和存在测试文件不等于通过本项目的安全与运行验证。

## 6. 何时改选 Tabby

- 如果你将目标改成“终端体验优先，文件通过外部编辑器处理”，Tabby 更有吸引力。
- 若 Termix 的独立桌面构建、认证/本地后端生命周期或统一派发入口无法以可维护方式改造，再重新评估 Tabby。
- 当前需求没有缩减，优先顺序仍为 Termix → Tabby；不是两套同时开发。

## 7. M0 验证门槛

1. 锁定一个 Termix 发布版本，完成 Windows 干净构建/安装/启动，确认不用额外远程服务或付费账号。
2. 对基础文件清单逐项演示，特别是编辑保存、目录上传、失败/暂停/恢复、特殊文件名。
3. 以假 AI 验证同一终端的接管竞态和拒绝规则，先不消耗真实模型额度。
4. 列出终端输入、AI、宏、自动化、SFTP 和隧道所有副作用入口，证明可统一拦截。
5. 核对主机密钥、凭据落盘、监听端口、原始日志、更新机制及当前公开安全公告/依赖。
6. 验证底座许可证、NOTICE、传递依赖和素材来源，保留上游身份与声明。

这些门槛不通过时，给出具体证据和替代方案。Windows 构建、独立启动与本地终端已有部分实测结果；默认打包链、完整文件工作台、接管竞态与安全/许可检查仍有待完成，详见[M0 报告](11-m0-validation.md)，不能把整个阶段标为已通过。

## 8. FinalShell 与 XTerminal 的位置

FinalShell 参考终端/SFTP 同屏、监控和快捷命令；XTerminal 参考连接工作台、AI 与操作确认。本次未核实到这两个客户端可直接复用的公开源码许可，暂不列为 fork 候选。GitHub 上的下载/打包仓库不能当成客户端源码许可证。

来源：[FinalShell 官方功能页](https://www.hostbuf.com/t/988.html)、[XTerminal 官方说明](https://docs.xterminal.cn/)、[Termix Apache-2.0 许可](https://github.com/Termix-SSH/Termix/blob/42f8270c2072f28486503a45fe91719eb5069b42/LICENSE)、[Tabby MIT 许可](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/LICENSE)。
