# 终端协议异常与桌面流程可靠性

状态：终端协议异常处理已实现并通过回归；Windows 本机回环 SSH 中 ConPTY/Git Bash 的输入兼容性仍需继续验证。完整产品目标不变。

## 发现的问题与证据

在 Windows 本机回环 SSH 测试服务器中，客户端发送完整 command，服务器端 ConPTY/Bash 偶尔只执行 ommand。旧环境为 Bash 5.2.37 / MSYS 3.5.4；独立试验在焦点报告与窗口缩窄同时发生时复现过丢首字母。失败事件记录见第 31 份文档，不能把这种不稳定输入说成网络传输丢字。

[VS Code 上游问题 #187804](https://github.com/microsoft/vscode/issues/187804)也记录过类似现象并将其归到 ConPTY 上游，但这只能作为调查线索，不能证明与本次根因完全相同。

使用[Git for Windows 2.55.0.windows.5 官方发布包](https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.5)内的 Bash 5.3.15 / MSYS 3.6.10，保持相同 ConPTY、焦点和缩窄步骤，12 次独立试验均未复现。MinGit 压缩包 SHA-256 为 56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e；完整 PortableGit 包为 5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290，均与官方记录核对。环境仅放在工作区测试目录，未覆盖用户安装的 Git，也未更换产品捆绑的 ConPTY。

## 产品修复

| 责任文件 | 修复与验收行为 |
| --- | --- |
| collaboration/adapters/pty-command.ts | 开始标记成功后才进入请求操作；检测匹配的结束标记先于开始标记时立即返回协议异常；状态核对最多 15 秒，操作超时仍遵循原配置 |
| collaboration/operations/gateway.ts | 协议损坏的命令结果保持 unknown，不信任退出码或工作目录，撤销自动控制权；不自动重试 |
| collaboration/tasks/runtime.ts | 区分协议异常和状态核对超时，暂停任务并归还控制权，不继续派发计划 |
| locales/en.json、translated/zh_CN.json | 明确显示“命令标记不完整”或“15 秒内未能核对终端状态”，提示人工检查 |
| use-task-workbench.ts / TaskPanel.tsx | 切换任务或新建流程后清除上一项操作错误，忽略旧视图的迟到错误；连接读取错误仍保留 |
| TaskWorkflowFiles.tsx | 文件选择先显示文件名，再在下方完整换行显示所选路径，避免长路径隐藏真实文件名 |

执行协议仍使用现有共享 Shell，不通过额外 SSH exec 模拟同一终端；目录和环境变量继续保留。测试证明已知的首字符丢失、开始输出命令失败不会直接进入请求操作。这不等于能防御远端任意字节损坏或恶意服务器；已经送出的操作仍可能有副作用，unknown 必须核实。

## 实际验证

- 原始协议、真实 Git Bash PTY 和任务协调专项：3 文件 / 48 项通过，.cache/pty-protocol-tests.log。
- 联合回归：40 文件 / 310 项通过，.cache/pty-protocol-regression.log，覆盖协作、流程、内置 AI 和中文界面。
- 实际打包 MCP stdio：2 文件 / 3 项通过，.cache/pty-protocol-packaged-stdio.log；Windows 系统凭据、签名管道和既有文件操作未被破坏。
- 全量类型检查、静态中文键检查及前后端构建通过。最终改动模块 lint 已收敛为无错误/警告；本地解包包仍复用已验证的原生模块，CI 单独执行标准原生构建。

真实桌面第一次负向探针被调试调用自身的短超时提前结束；随后改用实际中文授权按钮，并按任务状态观察，不延长或绕过应用的超时保护。

真实桌面报告 .cache/desktop-observation-report-7a0c0641-e686-4aca-bf03-c19dcf8bf602：

- 在自有测试 SSH 服务送入 ConPTY 前故意移除首条探测的首字母，应用 15 秒内返回 SHELL_CONTEXT_TIMEOUT，显示中文错误，控制权为 human，任务操作数为 0。
- 使用新版便携 Bash 的正常路径，automatic 和 collaborative 均完成保存流程的上传 → 真实共享 SSH Shell pwd → 下载；字节及 SHA-256 校验通过，未增加 SSH 认证连接。
- 授权从实际中文界面选择本地绑定、远端范围并提交；协作模式从实际操作卡逐条审批。原生选择器由测试主进程提供自有测试文件路径，并非人工操作操作系统对话框。
- 模板导出没有 localGrantId、localVersion 或 localPath；测试配对撤销，应用/SSH/PTY 正常退出。证据包括 damaged-probe-result.json、workflow-files-result.json、授权/审批截图和有界终端事件。

截图复核发现旧任务错误在新任务授权时仍显示、长本地路径难以区分，现已补上上述界面修复并追加回归。完整最终界面复验将在本页继续记录。

## 剩余范围

旧 Bash/MSYS 丢字问题没有被宣布彻底解决；本轮消除了应用错误等待、错误结果信任和误继续派发的缺口。还需继续真实 Linux/OpenSSH、Windows Shell/尺寸/焦点矩阵和压力验收。自动目录批次、传输跨重启恢复、加密草稿与备份、认证与跳板、监控/隧道、真实跨版本在线更新、汉化及许可证清单保持在完整目标中。

## 最终界面复验

最终修订的针对性回归 14 文件 / 105 项通过（包含上一联合回归中的部分用例，不与 310 简单相加），.cache/pty-protocol-final-tests.log；完整类型检查通过，.cache/pty-protocol-final-types.log。最终前后端构建和 Windows 解包包通过，.cache/pty-protocol-final-build.log、pty-protocol-final-package.log。

最终实际桌面报告 .cache/desktop-observation-report-047a516e-702b-44a1-a7b2-80a1f0ba7d6f 再次通过损坏探测保护及 automatic/collaborative 两种混合流程，.cache/pty-protocol-final-desktop.log 记录 cleanExit=true。验收额外断言切换新任务后旧超时错误已消失、两个本地绑定的完整路径可见；最终授权截图已人工视读核对。采用同样的本地文件、回环 SSH/SFTP、实际 stdio、中文按钮和专用原生选择器测试路径；没有使用用户服务器或付费模型。

第 31 份实现提交 2923fc9 的 [CI 34241705102](https://github.com/Zhqiankun/TandemSSH/actions/runs/34241705102/job/102113252342) 已通过全部步骤，包括标准 Spectre 原生工具链、Windows 安装包、安装/启动/卸载。它证明该提交的 CI 结果，不能替代本轮后续提交的构建状态。


## 2026-09-09 新版便携 Bash 的再次复现

上传批次收据改动的实际桌面复核在首次终端状态探测失败，任务尚未开始文件步骤。测试 SSH 原始输入记录包含完整的 if command printf，界面中的 Bash 错误却从 f command printf 开始，随后报告 unexpected token then。该次仍使用 .cache/PortableGit/bin/bash.exe；因此此前新版便携环境中的 12 次未复现，不能作为所有新版场景已解决的证明。

失败记录：.cache/desktop-observation-report-d18e31bb-77ea-4cab-a9e1-1b068e1960f8/fixture-pty-input.jsonl、desktop-failure-state.json、desktop-failure.json。应用返回 SHELL_CONTEXT_TIMEOUT，未继续运行流程步骤；验收器已结束并清理自有进程。

在测试夹具增加有界原始输出和尺寸事件记录后，未过滤输入、未延长/绕过产品探测，再次完成自动和协作目录三步流程及协作接管，正常退出。通过报告 .cache/desktop-observation-report-60e89bf2-22ac-42b9-80e4-2f4686b6f0dd，包含 fixture-pty-input.jsonl、fixture-pty-output.jsonl、fixture-pty-events.jsonl 与 workflow-directory-result.json。新增记录可能改变时序；本次成功证明当前流程的正向场景，不能证明偶发丢字已消除。具体 ConPTY/MSYS 层根因、真实 Linux/OpenSSH 及尺寸/焦点压力矩阵继续保留。

## 2026-09-09 任务恢复复验中的兼容性复现

独立任务双模式重启恢复曾完整通过（93aba7d6-7133-481e-b530-bd2877736352）。后续补录界面状态时，测试 SSH 服务的 ssh-input.jsonl 包含完整 if command printf；桌面终端显示 f command printf 并由 Bash 报 then 语法错误。应用随后按 SHELL_CONTEXT_TIMEOUT 暂停，业务步骤未派发。此证据再次表明 Windows ConPTY/Bash 测试链路的首字母丢失风险仍在，没有通过过滤输入、关闭上下文探测或宣称重试成功来消除它。失败现场记录在 task-execution-recovery-desktop-final.log 对应的 desktop-observation 报告。

上述任务恢复的首字母丢失失败现场为 .cache/desktop-observation-report-88c76a0e-1903-4342-be7a-abacc0647d48。最终包在等待真实 Shell 提示符并保留原始输出后，双模式恢复与界面完成状态通过（6d033345-0cf6-40e3-9997-52473331e9e0）；这只增加通过证据，不宣称原兼容问题消失。上一 dc27429 的云端终端组失败 4 项，本轮把交互 PTY 组独立运行，保留全部门禁，本地按同样顺序 3279 项应用测试与 10 项终端测试通过，4 项按既有条件跳过。
