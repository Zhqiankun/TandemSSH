# 中文目录任务与实际桌面验收

2026-09-09。本轮把原生目录能力、逐项任务网关、内置 AI 和 MCP 接到中文桌面。目录自动/协作的基本执行链已完成本机真实桌面验收；完整产品目标继续实施。

## 当前用户流程

1. 在“协作执行”中选择“目录传输”，创建自动或协作任务，无需填写命令。
2. 使用“选择上传目录”或“选择下载目录”授权本地文件夹。界面展示实际本地路径、扫描数量、排除项和覆盖许可；模型只取得任务目录 ID/版本。
3. 在任务授权中填写远端文件范围和操作预算，确认终端处于命令提示符后交还控制权。目录每个文件和每个目录独立消耗一次执行预算，预览与确认也各占一次。
4. 填写远端父目录或来源目录，生成固定预览。每页最多 100 项，可以新建、合并、跳过，以及在已获授权时覆盖；改名需要重新生成预览。核对每页条目、目标和处理方式后，才能提交完整批次。
5. 协作模式还需在任务操作卡中核对完整清单并逐项批准；自动模式只在任务授权范围内推进。界面展示任务操作状态与文件系统结果，审计缺口或 unknown 不会显示成整个任务成功。
6. 随时点击“立即接管”停止后续自动操作。核对结果并重新授权后，原批次继续剩余条目，已成功条目不重复执行。批次运行或暂停时不能释放预览、结束父任务或插入其他自动命令。
7. 完成后可以释放预览并结束任务；文件及任务操作结果保留。任务操作卡每页 50 条，可以返回旧记录或直接前往最新记录。

AI/MCP 提交的预览、清单和执行也显示在同一任务面板。下载/上传目录工具不会接受任意本地绝对路径或客户端自称的人类身份。

## 模块责任与依赖

主智能体独立负责以下变更。

| 模块 | 责任 |
| --- | --- |
| backend/collaboration/files/directory-http.ts | 可信桌面用户、严格参数解析、目录用例调用和受控错误响应 |
| ui/api/directory-transfer-api.ts | 目录桌面 HTTP 传输，复用共享类型，不含执行规则 |
| ui/features/collaboration/TaskDirectoryTransfers.tsx | 本地授权与远端路径选择、预览切换、批次状态和用户操作编排 |
| ui/features/collaboration/DirectoryTransferManifest.tsx | 分页清单、冲突选择、改名、逐页核对以及任务/物理结果的分别展示 |
| TaskPanel.tsx / TaskLocalFiles.tsx | 目录任务创建、原生目录票据、审批接线、任务结束与操作卡分页 |
| backend/collaboration/files/directories.ts | 父任务批次互斥、控制权变化与逐项推进，分页结果关联实际操作状态 |
| backend/files/directory-transfers.ts | 固定目录清单、子项范围检查、文件服务复用与超时继承 |

依赖方向继续为界面/AI/MCP → 用例 → TaskRuntime/OperationGateway → 原生/SFTP 能力。没有新增无业务归属的共享层，没有新增数据库迁移；普通文件和命令入口保持原有约束。

任务显式操作预算上限为 5000，默认值不变。网关仍限制普通操作记录为 512 条，目录动作与普通动作合计最多 8192 条；单个目录动作 JSON 最多 512000 字节，目录动作累计最多 8 MiB。新增测试验证目录可超过普通操作上限、普通上限继续生效，以及大清单和累计容量被拒绝。这些测试验证边界，不代表已完成大目录性能验收。

## 实际桌面证据

本机运行 app/release/win-unpacked/TandemSSH.exe，使用独立测试配置、真实回环 SSH/SFTP、共享 Bash/ConPTY 会话和实际原生文件能力。选择框由验收脚本固定为本次创建的测试目录；授权、清单核对、审批、接管及恢复均操作中文桌面控件。没有连接真实业务服务器，也没有调用付费模型。

| 模式 | 方向与入口 | 验证结果 |
| --- | --- | --- |
| 自动 | 中文工作台创建目录任务并上传 | 4 项成功，字节及 SHA-256 一致，空文件/空目录保留 |
| 自动 | 实际 MCP stdio 预览并下载 | 4 项成功，重复请求返回同一批次，无本地路径泄露 |
| 协作 | 中文工作台上传、桌面逐项审批 | 清单未核对时确认按钮禁用，批准后逐项执行成功 |
| 协作 | 实际 MCP 下载、桌面审批与接管 | 创建首个目录后人工接管，后续文件没有继续写入；重新授权后剩余项完成，成功条目没有重复 |

四组均复用已连接 SSH，没有新增认证连接。桌面及验收脚本正常退出，cleanExit=true。证据目录为 `.cache/desktop-observation-report-97dfb764-2e86-4c37-a901-2e4bb18c8903`，包含 directory-result.json、四组完成截图、协作清单截图和接管截图；执行日志为 `.cache/task-directory-desktop.log`。已目视检查协作清单截图，中文标签与长路径换行正常。

## 自动验证与包检查

提交前完整相关回归 **69 文件 / 492 项通过**，`.cache/directory-workbench-full-regression-final.log`。初轮发现两个旧集成测试仍将 MCP 工具数写为 29，导致自动/协作共 4 项数量断言失败；已更新为 34 并完整复测，未删除实际 PTY、文件编辑或授权检查。初轮日志保留于 `.cache/directory-workbench-full-regression.log`。

- 中文目录/原生选择/任务面板/错误隔离、HTTP、核心批次和 AI/MCP 联合回归：9 文件 / 35 项通过，`.cache/directory-workbench-regression.log`。随后新增操作历史分页场景，任务面板与目录界面专项 2 文件 / 11 项通过，`.cache/directory-workbench-history-tests.log`。
- 网关容量与文件授权回归：2 文件 / 36 项通过，`.cache/directory-workbench-capacity-tests.log`。
- 实际打包 MCP stdio、系统配对和文件传输：2 文件 / 3 项通过，`.cache/directory-workbench-packaged-mcp.log`。其中启动真实 Codex app-server 验证工具发现，使用临时配置，未修改日常 Codex 配置；`.cache/codex-mcp-integration.json` 记录 34 项工具及目录工具名称。
- 最终类型、改动模块 lint、中文静态键检查通过：`.cache/directory-workbench-delivery-types.log`、directory-workbench-delivery-lint.log；中文缺失静态键为 0。
- 前后端构建和 Windows 解包验证包通过：`.cache/directory-workbench-build.log`、directory-workbench-package.log。
- 实际 Electron 原生探针确认 fileCapabilities、directoryCapabilities、SQLite、串口、系统凭据和 PTY 均可加载，依赖 13 项，6 个能力模块 SHA-256 与源码一致：`.cache/directory-workbench-native-package.log`。

上述测试集合存在重叠，不累加为全量产品验收计数。本机验证包复用已验证的原生依赖，标准 Windows 原生重编译、NSIS/ZIP 及安装卸载门禁由本次推送后的 Actions 执行。尚未将当前版本发布为正式 Release。

## 继续实施的范围

本轮不替代完整目标中的跨重启检查点、目录保存流程步骤、历史/草稿/凭据统一、SSH 认证及 Linux/OpenSSH 断线权限矩阵、监控/隧道、真实跨版本在线升级和全部 A01–A37 验收。

目录方面还需补齐：过期预览的自动回收和长期运行容量释放；把不可继续的批次错误与可恢复暂停明确区分；完整冲突/目录跳过/失败审计矩阵；大量条目的性能和传输层任务历史分页。目前界面已分页渲染操作卡，任务快照接口仍返回完整记录，不能将其视作已完成大批次压力验收。内置 AI 目录编排已通过可控模型流与真实 SFTP 测试；本轮真实桌面验证集中在中文工作台与 MCP。
