# TandemSSH · 同舟 SSH

一个面向人机协同的开源 SSH 桌面客户端：人和 AI 共用终端，执行过程可见，控制权随时可收回。

**当前状态：已开始实施，默认简体中文。** 正式源码位于 `app`，已有 Windows 开发验证包、中文协作工作台，以及通过真实桌面 SSH 验证的自动命令流程和 MCP 命令接入。内置 AI 也已接入同一网关并完成本机 HTTP + SSH 验证；中文流程库、参数编辑、导入导出和规则试算已完成本机桌面验证；AI/MCP 文件读写、目录/属性查询和旧快捷命令/顺序宏已接入统一任务入口，手工分块上传队列、校验和恢复已接入文件工作台，首次主机信任、密钥变化拒绝及重启后的信任保存已完成本机桌面验证；手工下载已接入原生分块落盘与队列，整目录/多选下载已支持中文整批预览、明确冲突处理和逐项结果；目录上传已接入中文批次预览、原生来源与共享队列；AI/MCP 已支持已授权单文件上传/下载，保存流程已接入上传 → 命令 → 下载及中文文件绑定；AI/MCP 目录批次已接入中文预览、逐项执行与接管恢复，自动/协作双向目录已通过本机桌面验证；保存流程也已支持目录上传 → 命令 → 目录下载及中文目录槽位；跨重启恢复继续补齐；实际进度与验证见[实施记录](docs/12-implementation.md)。

## 仓库与版本更新

源码仓库：[Zhqiankun/TandemSSH](https://github.com/Zhqiankun/TandemSSH)。当前为开发预览，完整功能清单仍在实施。标准 Windows 构建、安装、中文启动及卸载保留数据已通过 CI；Actions 提供 NSIS/ZIP 预览包，跨版本在线升级与正式 Release 仍待完成。

桌面仪表盘的版本区域提供“检查更新 / 更新版本”：检查版本、下载进度、取消下载和重启安装。在线安装适用于 Windows 安装版；免安装版可打开发布页下载新版。安装前会要求保存草稿并结束连接。更新源固定为本仓库，不会安装上游 Termix 的发行包。

普通推送/PR 运行 [CI](https://github.com/Zhqiankun/TandemSSH/actions/workflows/ci.yml)；稳定版本标签推送运行 [Release](https://github.com/Zhqiankun/TandemSSH/actions/workflows/release.yml)，生成 NSIS、ZIP、更新清单和校验和。详细发布方式与实际验证见[版本发布文档](docs/25-github-releases.md)。

## 已确认的方向

- Windows 优先的桌面客户端，中文界面优先。
- 开源；自己的模型 API 地址、API Key 和模型名称可配置，不以软件会员解锁。
- 人工、协同和自动三种工作方式；人工可以随时接管，再交还 AI。
- 自动执行与人机协作是基础验收标准；Codex 通过 MCP 复用相同会话、规则和记录。
- 能看到目标服务器、命令、执行者、输出和结果。
- 命令黑白名单可配置，并具有明确的作用范围、冲突规则和验证入口。
- 黑白名单硬限制 AI、MCP、流程及受控入口；人工终端保留自由接管。
- 自动模式允许本任务范围内预授权，明确拒绝规则仍然优先。
- 默认本机保存脱敏记录，保留 7 天或最多 100 MB；完整终端录制手动开启。
- 多条命令可组成自定义流程，按顺序执行，支持参数、逐步结果和中途接管。
- 完整基础 SSH/SFTP 能力：上传下载、目录操作、远程文件在线编辑、传输队列和冲突处理均进入首版。
- 结合 FinalShell 的终端/文件/监控工作台和 XTerminal 的连接/AI 协作体验；优先评估开源底座复用。

工作名由助手拟定为 **TandemSSH（同舟 SSH）**。`Tandem` 表示协同；名称和仓库 slug 可在公开发布前调整。

## 文档导航

| 文档 | 回答的问题 |
| --- | --- |
| [产品需求](docs/01-product.md) | 做给谁用、首版做什么、怎样算完成 |
| [界面与协作流程](docs/02-experience.md) | 如何连接、协同、接管、交还、查看执行记录 |
| [系统架构](docs/03-architecture.md) | 模块责任、依赖方向、技术选型和存储边界 |
| [会话与接口契约](docs/04-contracts.md) | 控制权、状态机、事件、错误与并发语义 |
| [策略与安全设计](docs/05-security-policy.md) | 黑白名单如何生效、凭据如何保护、风险在哪里 |
| [交付与验收计划](docs/06-delivery.md) | 实施顺序、验证场景、发布门槛 |
| [决策与参考来源](docs/07-decisions.md) | 哪些已确认、哪些待定、参考了什么、如何开源 |
| [自定义命令流程](docs/08-workflows.md) | 如何把“先做 A、再做 B”保存、运行和导出 |
| [基础 SSH 与文件工作台](docs/09-base-features.md) | 基础功能有哪些、在线编辑与上传下载如何保证结果明确 |
| [开源底座评估](docs/10-open-source-base.md) | 能复用什么、主候选与备选、如何验证和保留许可来源 |
| [M0 Windows 验证与改造入口](docs/11-m0-validation.md) | 原始底座构建/启动基线与改造依据 |
| [实施与汉化记录](docs/12-implementation.md) | 当前代码、中文界面、测试结果和未完成工作 |
| [MCP 接入与验证](docs/13-mcp.md) | 配对、Codex 配置、当前工具与实际验证边界 |
| [内置 AI 与共享终端](docs/14-built-in-ai.md) | 自带模型接口、规划、执行、问答、接管与验证 |
| [保存流程实施说明](docs/15-saved-workflows.md) | 已保存定义、参数、预览和执行语义的实现与剩余工作 |
| [AI/MCP 调用保存流程](docs/16-ai-mcp-workflows.md) | 独立流程与父任务复用、授权边界和实际验证 |
| [带版本的文件编辑](docs/17-file-documents.md) | 草稿、冲突保存、编码和人工接管的实现与专项验证 |
| [文件动作网关与路径授权](docs/18-file-operation-gateway.md) | 文件/命令共用队列、独立路径权限与中文配置；工具接入状态 |
| [AI/MCP 文件工具](docs/19-ai-mcp-files.md) | 正式 SSH/SFTP 接入、文件修改与人工审阅 |
| [旧快捷命令与宏迁移](docs/20-legacy-command-migration.md) | 模式选择、待授权任务、参数绑定与旧自动化执行边界 |
| [目录与文件属性查询](docs/21-file-inspection.md) | 24 项 MCP 工具、目录分页、子项规则、链接属性与验证 |
| [分块上传与队列](docs/22-upload-transfers.md) | 手工上传预览、校验、暂停恢复、身份绑定与实际验证 |
| [SSH 主机信任](docs/23-host-trust.md) | 首次人工核对、密钥变化拒绝、持久化与桌面验证 |
| [下载与原生落盘](docs/24-download-transfers.md) | 来源版本、分块传输、本地临时文件、暂停恢复与校验 |
| [GitHub 与在线更新](docs/25-github-releases.md) | 更新按钮、固定发行源、Actions 与版本发布 |
| [目录批量传输](docs/26-directory-transfers.md) | 来源集合、目标预览、目录创建与批次队列接入进度 |
| [目录上传批次](docs/27-directory-uploads.md) | 目录上传中文预览、原生来源、批次队列及验证 |
| [AI/MCP 文件传输](docs/28-automated-transfers.md) | 二进制执行核心、本地授权边界与文件流程接入计划 |
| [任务本地文件授权](docs/29-local-file-grants.md) | 中文来源/目标选择、私有进程通道、任务授权与撤销验证 |
| [AI/MCP 传输工具](docs/30-transfer-tools.md) | 29 项 MCP 工具、内置 AI 文件传输与真实桌面自动/协同验证 |
| [保存流程中的文件步骤](docs/31-workflow-files.md) | 混合步骤、中文本地文件绑定、父任务预算与恢复验证 |
| [终端可靠性记录](docs/32-terminal-reliability.md) | 损坏标记与核对超时处理、实际桌面正负向验证及兼容风险 |
| [任务目录传输接入](docs/33-task-directory-transfers.md) | 原生目录授权、逐次 I/O 检查与 AI/MCP 目录工具接线进度 |
| [目录批次与模型工具](docs/34-directory-task-adapters.md) | 逐项任务执行、AI/MCP 目录工具、验证证据与剩余中文桌面接线 |
| [中文目录工作台](docs/35-directory-workbench.md) | 目录任务创建、分页审核、逐项审批、实际桌面与 Codex 验证 |
| [目录保存流程](docs/36-workflow-directory-steps.md) | v3 目录槽位、冲突策略、父任务游标与实际桌面双模式验证 |

## 产品主线

```text
选择服务器 → 打开 SSH 终端 → 让 AI 理解当前任务
→ 查看计划和执行 → 随时接管 → 人工处理 → 交还 AI → 验证结果
```

FinalShell 的终端/SFTP 同屏与服务器监控、XTerminal 的连接管理与 AI 操作确认用于产品参考。当前 app 已采用固定 Termix 发布源码；Tabby 为早期备选，ssh-mcp-server 为技术参考。共享会话接管和统一策略须单独验证、补齐，不假设任何候选已满足 TandemSSH 的全部要求。

## 文档状态和范围

初始 M0 基线（2026-09-05）：按继续验证的要求在独立 `upstream/termix` 中拉取发布源码、安装依赖、构建并试运行。前后端构建和 36 项上游测试通过；默认原生重编译缺少 Spectre 库，使用现有模块生成的本地验证包完成了工作台与本地终端检查。未连接真实 SSH 服务器、调用模型或发布仓库。

后续已进入正式 app 改造并完成多轮本机 SSH/MCP 验证；最新结果见实施记录与 MCP 文档。测试应用已退出，源码与验证产物保留在本机。`upstream`、`.tools`、`.cache` 被 Git 忽略，不能当作正式开源发行结构；运行数据也不随文档提交。

技术栈、许可来源、已确认范围与发布前事项集中在[决策记录](docs/07-decisions.md)。M0 尚未全部通过，文档中的目标行为不代表上游已经满足。
