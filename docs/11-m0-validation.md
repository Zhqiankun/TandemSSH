# M0：Termix Windows 底座验证与改造入口

验证日期：2026-09-05。结论：**Termix 具备继续作为底座验证的条件：前后端可构建，本地验证包能进入独立工作台，打包后的本地终端可执行并返回结果。M0 尚未全部通过，TandemSSH 的协作功能尚未实现。**

本轮承接[底座评估](10-open-source-base.md)。评估用源码保留在 `upstream/termix`，没有覆盖项目文档、改品牌或发布仓库。测试结束后已退出桌面及后端，临时调试端口已关闭。

## 1. 本轮确定的产品规则

| 事项 | 用户确认的行为 | 实施约束 |
| --- | --- | --- |
| 人工自由接管 | 黑白名单限制 AI、MCP、流程；人工直接终端自由操作 | 自动化不能伪装成人工；人工点击运行流程仍执行规则 |
| 自动模式预授权 | 可在本任务范围内提前批准重启服务、覆盖文件等操作 | 明确 deny 优先；任务、目标、路径、动作和有效期必须匹配 |
| 默认记录 | 本机脱敏记录，默认 7 天或最多 100 MB | 任一上限先到即清理最旧记录；完整终端录制单独手动开启 |

预授权的建议契约已经补入[接口文档](04-contracts.md)与[策略文档](05-security-policy.md)。自动模式中的有效任务授权可满足范围内的确认要求；协同模式仍逐步确认。接管等事件使旧授权失效，交还时核对并重新签发，不跨任务继承。

## 2. 固定源码和构建环境

| 项目 | 本次值 |
| --- | --- |
| 上游 | [Termix-SSH/Termix](https://github.com/Termix-SSH/Termix) |
| 发布标签 | `release-2.7.1-tag` |
| 提交 | `76fd9eedbf0f7e853d5ffe40717cac126ffe6a98`，2026-08-22 |
| package.json | `termix` / `2.7.1` |
| 上游许可证 | Apache-2.0，保留原 LICENSE 与作者声明 |
| 本机系统 | Windows x64，构建工具报告 `10.0.22000` |
| 构建运行时 | 项目内 Node `24.20.0` / npm `11.19.0` |
| Electron | `43.2.0`，内嵌 Node `24.18.0` |
| electron-builder | `26.15.3` |
| 本机 MSVC | VS 2022 Build Tools / `14.44.35207`，未安装所需 Spectre 库 |
| 源码改动 | 上游受 Git 跟踪文件无改动，`git status --short` 为空 |

第 10 份文档检查的是较新的 main 提交；本轮有意锁定发布标签，因此两份报告的提交号不同，不能混用行号或把 main 当成本轮产物来源。

可复核摘要：

```text
package-lock.json SHA256
6B474B898371D79F7FCABF98AB9359184D96100F8C16A1846E4A637B089FFDC4

node-v24.20.0-win-x64.zip SHA256（已与官方 SHASUMS256.txt 比较）
6CAC9FFBCA8F6A47091E4B5C772E0606049C3871CB67D900C0CEDDE630E545BA

本次 release/win-unpacked/Termix.exe SHA256
75E8C60B7CEDD4391228AAFD5BB89881D09CB0BCB5D5E88C74E7BAD68A283511
```

构建使用上游锁文件。npm 下载使用 npmmirror，Electron 安装器按包内校验表验证下载。没有修改全局 Node/npm。npm 11.19 对部分依赖安装脚本给出未批准提示；本轮随后显式安装 Electron、执行原生模块诊断，并尝试上游默认 rebuild，不能仅凭 `npm ci` 成功推断原生模块已可用。

## 3. 实测结果

| 检查 | 结果 | 证据和边界 |
| --- | --- | --- |
| 固定标签拉取、依赖安装 | 通过 | 独立浅克隆，`npm ci` 退出码 0 |
| 前端与后端构建 | 通过 | `npm run build` 退出码 0；包含 Vite 与后端 TypeScript 编译，不代表全项目 lint/type-check 已通过 |
| 指定上游测试 | 通过 | 4 个文件、36 项测试；终端会话管理、AI allowlist、终端宏、桌面退出辅助函数 |
| Electron 原生模块 | 通过限定检查 | SQLite 内存库写入/读取；串口绑定加载；node-pty 执行本地命令并校验输出与退出码 |
| 默认 Windows 解包构建 | 未通过 | node-pty 源码重编译遇到 `MSB8040`，缺少 Spectre 库 |
| 使用现有原生模块的解包构建 | 通过 | 命令行覆盖 `npmRebuild=false`，输出 `release/win-unpacked`；上游配置未修改 |
| 打包应用独立启动 | 通过限定检查 | `app.isPackaged: true`；内置后端 ready；进入 local 用户工作台，数据库 Healthy |
| 打包后的本地终端 | 通过 | 从实际 renderer 调用公开 preload：启动 PowerShell、发送命令、收到展开后的标记及退出码 0 |
| 退出后的资源清理 | 通过本次检查 | 应用/后端进程归零，临时调试端口 19322 和本次后端监听释放 |
| 安装/卸载、签名 | 未验证安装/卸载 | 本次为解包目录，`Termix.exe` Authenticode 状态 `NotSigned` |
| SSH/SFTP 真实远端 | 未执行 | 未使用真实服务器、私钥或密码；本地终端成功不代表远程功能已验收 |
| 人机接管与可配置规则 | 未实现、未实测 | 36 项上游测试不覆盖本项目 epoch、预授权与统一网关 |
| 依赖漏洞/许可全量检查 | 未完成 | 未运行完整依赖审计，也未核查所有传递依赖与发行资源 |

打包日志中的 signing 阶段文字不能作为签名成功的证据，以实际 Authenticode 状态为准。本次验证包沿用 Termix 的名称、图标和版本，仅用来评估底座。

诊断脚本：[native-smoke.cjs](../scripts/m0/native-smoke.cjs)。它只创建内存数据库和一次性本地终端，不枚举串口设备、不连接 SSH。另一次打包后 IPC 检查验证了实际发行目录中的依赖加载，避免只检查开发目录。

## 4. 已发现的问题与处理

### V01：默认构建缺少 MSVC Spectre 库

复现：安装锁定依赖后执行 `electron-builder --win --x64 --dir --publish never`。预期生成解包目录，实际在 node-pty 的 conpty/winpty 项目报 `MSB8040`。

上游 Windows CI 本身也有[安装 Spectre 库步骤](https://github.com/Termix-SSH/Termix/blob/76fd9eedbf0f7e853d5ffe40717cac126ffe6a98/.github/workflows/electron.yml#L80)。这不是已经证明底座不能在 Windows 打包，而是本机工具链缺失。

本轮默认 rebuild 已成功处理 serialport、better-sqlite3、cpu-features，随后在 node-pty 失败。验证包复用这些现有模块及 node-pty 随包预编译文件，显式跳过重复 rebuild，并在实际 Electron 和打包应用中验证加载。没有关闭 Spectre 编译选项。正式可复现构建仍需补齐 CI/MSVC 工具链，在干净环境重跑默认路径。

### V02：桌面后端并非全部只监听本机

运行时按本次后端 PID 检查发现：`30001—30008、30010、30011` 监听 `::`，`30009` 监听 `0.0.0.0`；只有 homepage `30012` 监听 `127.0.0.1`。临时调试端口 `19322` 为 `127.0.0.1`，已在检查后关闭。

这证明存在通配地址监听，**尚未测试其他设备能否穿过 Windows 防火墙访问，也未证明可绕过身份认证**。TandemSSH 的桌面独立模式应让业务 HTTP/WS 服务显式绑定回环地址，并保留鉴权；用户主动建立的 SSH 转发监听另按隧道授权范围处理，不能用全局网络补丁混在一起。

对应源码包括 `database/database.ts:2038`、`hosts/terminal/index.ts:130`、`hosts/docker/console.ts:37`、`hosts/serial.ts:19`。这些是当前发布提交的相对路径，均位于 `src/backend` 下。

### V03：外部版本检查与 OPKSSH 下载影响首启

本轮 GitHub API 返回 403/rate limit，首次界面显示 `Update Required / Version Check Error`。点击已有的 `Continue` 后进入工作台，本地数据库和本地终端正常。

后端启动还会尝试初始化/下载 OPKSSH，本次因 GitHub 限流失败；没有测试 OPKSSH 认证。`ENABLE_GUACAMOLE=false` 不能视作关闭所有附加服务或所有联网行为，运行时仍存在其他服务端口。

改造要求：版本检查失败不能阻挡本地 SSH 工作台；OPKSSH 等可选功能需要按需启用、版本固定与下载验证。正常使用不能依赖 GitHub API 可用性。本轮没有给 Termix 配置模型 Key，也没有发起模型请求。

### V04：构建提示与诊断工具边界

Vite 提示部分产物超过 1000 kB，以及配置文件在未来 native loader 下的兼容提示，未导致本轮构建失败。尚未测量冷启动性能、持续终端输出或内存峰值。

最初的一次诊断在 PTY 退出后保留了测试进程句柄，已为一次性 harness 增加完成后退出并复测，残留测试进程也已清理。关闭桌面时，CDP 请求未返回而触发 harness 超时；随后按实际进程、端口和后端 shutdown 日志确认应用已退出，不把调试工具返回状态代替产品运行事实。

### V05：异常退出后的 PID 文件清理还需验证身份

静态检查 `electron/main.cjs` 的 `reapOrphanedBackendProcess` 发现：读取 backend.pid 后，用 `process.kill(pid, 0)` 检查进程存在，再按 PID 终止。存在性检查本身不能证明该 PID 仍属于此前的后端。若 PID 被系统复用，应核对进程身份/启动标记后再清理。本轮正常退出没有触发这一情形，尚未复现误终止，也不将其写成已确认的公开漏洞。

## 5. 文件责任与依赖方向

当前负责人均为项目维护者。下表前两列为本轮已检查的上游位置；新增目录是下一阶段方案，尚未创建或接入。

| 领域 | 上游入口（相对 `upstream/termix`） | 改造责任 |
| --- | --- | --- |
| 桌面生命周期 | `electron/main.cjs`、`electron/preload.js`、`src/backend/starter.ts` | 有限 IPC、独立数据目录、本机监听、可选服务启停、退出清理 |
| 终端会话和输入 | `src/backend/hosts/terminal/session-manager.ts`、`index.ts` | 保留 transport，接入单一控制器；两条 input 路径都检查控制权 |
| AI 工具执行 | `src/backend/ai/tools/executor.ts`、`command-allowlist.ts` | 模型提出动作，网关判断和派发；固定 allowlist 迁移为规则输入之一 |
| 终端宏与流程 | `src/ui/lib/terminal-macros.ts`、`src/backend/automations/engine.ts`、`actions/index.ts` | 宏 UI 可复用；可靠流程调度放后端，调用同一网关 |
| 文件操作 | `src/backend/hosts/file-manager/content-routes.ts`、`transfer-engine.ts`、`index.ts` | 上传/保存/删除/改权限等归入受控动作；保留 SFTP 适配与进度能力 |
| 在线编辑 | `src/ui/features/file-manager/components/CodeEditor.tsx` | 草稿、编码/换行、打开时基线、冲突展示；不得直接承担最终授权 |
| 隧道 | `src/backend/hosts/tunnel/index.ts`、`manager.ts` | 启停、监听范围和远端清理命令需统一授权 |
| 主机监控与管理 | `src/backend/hosts/metrics`、`src/backend/hosts/docker` | 只读采样与重启/终止/容器操作分开，所有变更行为走网关 |

建议新增目录映射：

```text
src/types/collaboration.ts                 跨进程 DTO、事件与错误
src/backend/collaboration/sessions/        控制权、generation/epoch、输入串行化
src/backend/collaboration/policies/        规则合并、范围试算、授权有效性
src/backend/collaboration/operations/      动作快照、幂等、派发与结果编排
src/backend/collaboration/audit/           脱敏、留存与事件缺口
src/backend/collaboration/adapters/        连接现有 SSH/SFTP/存储的适配实现
src/ui/features/collaboration/             操作卡、接管按钮、控制者状态和时间线
src/backend/tests/collaboration/           契约、策略与可控调度的竞态测试
```

依赖方向：UI / AI / MCP / 流程 → 网关公开入口 → 策略与会话/文件用例 → transport。核心领域定义端口，适配器实现端口，由启动组合入口注入；核心不导入具体页面或数据库表。文件用例与网关避免相互引用：编辑编排发起动作，已授权文件执行端口只完成 SFTP 操作。

本轮没有新增业务共享层，没有把代码塞进 `common/utils`，也没有移动上游目录。`scripts/m0` 仅负责诊断，通过参数指向底座，不成为应用运行依赖。

## 6. 接管可行性：证据与仍须证明的部分

已定位到的关键路径：

- 人工/共享终端输入：`hosts/terminal/index.ts:256` 与 `:767`，分别直接写入流。
- 宏：`src/ui/lib/terminal-macros.ts:116` 调用 `terminal.send`。
- AI：`ai/tools/executor.ts:313` 调用 SSH pool 的 `execCommand`，不是当前 PTY。
- 自动化：`automations/actions/index.ts:390`、`:394` 调用 `execElevated/execCommand`。
- 文件保存：`hosts/file-manager/content-routes.ts` 的 writeFile 路由；传输、删除等还需按路由展开清单。
- 隧道：`hosts/tunnel/manager.ts` 包含转发监听及远端端口检查/清理命令，不能只拦终端输入。

这些入口说明可通过适配逐步收敛，但**尚未穷尽所有副作用路径，也没有证明当前代码已能统一拦截**。Docker、监控操作、共享会话、snippets、后台自动化以及本地终端都要列入后续清单；尚未接管的自动化入口在验证版中应停用。

同 PTY 的接管验证必须真正证明：AI 改变 cwd 后人工接管仍处于该上下文；人工改变上下文后交还 AI 能识别变化；不能只用两条独立 exec 通道制造相似输出。命令结束标记、退出码、交互程序和输出缺口要另行设计，普通 Shell 提示符不能当作成功依据。

下一轮采用假模型与可控 transport，先覆盖以下可重放场景，再接入真实测试 SSH：

| 场景 | 必须观测到的结果 |
| --- | --- |
| 入队后、发送前接管 | 接管应答后旧 epoch 没有新的 write |
| 等待审批时接管，批准迟到 | 旧批准拒绝，动作不发送 |
| AI 响应迟到或切换标签 | 拒绝旧 generation/epoch，目标不会跟随当前标签改变 |
| 接管再交还 | 新 epoch；已完成步骤不重跑，旧批准/任务授权不复活 |
| 黑名单与任务预授权冲突 | 始终 deny，记录规则来源 |
| 人工直接输入与人工点击运行流程 | 前者保留自由输入；后者仍受策略限制 |
| 请求重试或派发后断线 | 同 requestId 不重复执行；无法确认结果标 unknown |
| 传输在途时接管 | 禁止新动作，准确展示仍在途的文件操作，不宣称已撤销 |

## 7. 复现入口与本地证据

以下 PowerShell 命令在项目根运行。需先有上述固定版本源码与依赖；命令出错时停止处理，不把后续结果当作整段成功。

```powershell
$taskRoot = 'E:\aiSSH'
$taskRuntime = Join-Path $taskRoot '.tools\node-v24.20.0-win-x64'
$env:PATH = "$taskRuntime;$env:PATH"
$env:HUSKY = '0'
$env:electron_config_cache = Join-Path $taskRoot '.cache\electron-download'
$env:ELECTRON_BUILDER_CACHE = Join-Path $taskRoot '.cache\electron-builder'

Push-Location (Join-Path $taskRoot 'upstream\termix')
try {
  git rev-parse HEAD
  & "$taskRuntime\node.exe" "$taskRuntime\node_modules\npm\bin\npm-cli.js" run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  & "$taskRuntime\node.exe" node_modules/vitest/vitest.mjs run src/backend/tests/hosts/terminal/session-manager.test.ts src/backend/tests/ai/command-allowlist.test.ts src/ui/tests/lib/terminal-macros.test.ts scripts/electron-app-quit.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
} finally { Pop-Location }
```

npm 位于运行时目录而不是项目 node_modules。默认打包检查使用相同环境：

```powershell
Push-Location (Join-Path $taskRoot 'upstream\termix')
try {
  & "$taskRuntime\node.exe" node_modules/electron-builder/cli.js --win --x64 --dir --publish never
  if ($LASTEXITCODE -ne 0) { throw 'Default packaging failed; inspect the original error' }
} finally { Pop-Location }
```

本轮验证包的额外覆盖参数为 `'--config.npmRebuild=false'`，只用于已验证的模块组合。它不是默认发行流程，不能用来宣称干净构建通过。

原生检查需临时设置 `ELECTRON_RUN_AS_NODE=1`，用 Electron 运行 `scripts/m0/native-smoke.cjs`，第二个参数传 checkout 绝对路径。启动图形桌面前必须删除该环境变量。桌面运行使用 `TERMIX_DATA_DIR=E:\aiSSH\.cache\termix-profile`，以免写入已有个人 Termix 配置；本轮另设 `ENABLE_GUACAMOLE=false`。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  $taskSmoke = Start-Process -FilePath E:/aiSSH/upstream/termix/node_modules/electron/dist/electron.exe -ArgumentList @('E:/aiSSH/scripts/m0/native-smoke.cjs', 'E:/aiSSH/upstream/termix') -WorkingDirectory E:/aiSSH/upstream/termix -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput E:/aiSSH/.cache/termix-native-smoke.log -RedirectStandardError E:/aiSSH/.cache/termix-native-smoke.err.log
  if ($taskSmoke.ExitCode -ne 0) { throw 'Native smoke failed' }
} finally {
  Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
```

本地证据（均在被 Git 忽略的 `.cache` 中，不随开源仓库提交）：

| 文件 | 内容 |
| --- | --- |
| `termix-build.log` | 前后端构建结果 |
| `termix-targeted-tests.log` | 4 文件 / 36 测试 |
| `termix-native-smoke.log`、`.err.log` | 原生模块诊断 |
| `termix-package-default.log` | 默认路径的 MSB8040 失败 |
| `termix-package-prebuilt.log` | 验证目录打包结果 |
| `termix-packaged-terminal.log` | 实际打包应用 IPC/终端输出验证 |
| `termix-listeners.json` | 按本次进程采集的地址/端口 |
| `termix-desktop.png` | 进入本地工作台的截图 |
| `termix-profile/termix-main.log` | 内置后端 ready、GitHub 失败及退出记录 |

`.cache/termix-profile` 是上游临时运行数据，不能视作已实现 TandemSSH 的脱敏与 7 天/100 MB 留存要求，不应上传。`upstream`、`.tools`、`.cache` 已加入根 `.gitignore`；日后正式采纳源码时单独保留来源与许可，不能让整个应用长期藏在忽略目录里。

## 8. 下一步与验收门槛

推荐继续 Termix，不因当前机器缺少构建库就切换 Tabby。下一阶段先完成本机服务边界和可选服务开关、共享 PTY 控制原型，再使用一次性 SSH 测试环境演示上传/下载/编辑/冲突。完整品牌与 UI 改造、真实模型调用和公开发行放在这些结果之后。

M0 仍欠：干净 Windows 默认打包/安装/卸载、依赖及资源许可清单、公开安全公告核对、完整 SSH/SFTP 基线、主机信任与凭据存储测试、接管竞态与所有副作用入口清单。是否正式 fork/进入产品实施，以这些证据和已确认范围为依据；当前不能把全部门槛打勾。

本轮文档收尾检查：12 份 Markdown、34 个本地链接、2 个 JSON 示例、3 个 PowerShell 代码块均通过相应存在性/解析检查；诊断脚本通过 Node 语法检查。此类检查只验证文档与脚本结构，不替代上述产品验收。
