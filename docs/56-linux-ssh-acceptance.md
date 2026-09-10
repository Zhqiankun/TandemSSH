# 真实 Linux SSH 集成验收

本阶段补齐文档要求的一次性 Linux 测试服务器。现有 Windows 本机 SSH/SFTP 夹具继续用于可控回归；真实 Linux 的 UID/GID、权限、PTY 和文件系统行为单独验证。

测试机使用项目目录下的便携 QEMU 11.1.0、官方 Alpine 3.24.1 BIOS cloud-init 镜像、独立 QCOW2 写入副本和 CIDATA 配置盘。分配 2 个虚拟 CPU、1 GB 内存、4 GB 虚拟磁盘；不共享宿主目录，用户网络启用 restrict，SSH 与 QMP 只监听 127.0.0.1。临时账号和密钥仅保存在 Git 忽略的 `.cache/linux-lab/runs/<id>`。

下载验证：QEMU 安装包 SHA-512 与官方校验文件匹配；Alpine 镜像 GPG 验证成功，公钥指纹与官方页面的 `F26ADFADBAE702EF7AF637459DA7EF23BFFCDF22` 一致。便携解压工具从 7-Zip 官方链接的 MSI 只读提取，未执行安装；MSI SHA-256 与 GitHub 发布资产 digest 匹配。Pycdlib 1.20.0 只安装到项目缓存，用于生成配置盘。

`src/backend/test-helpers/linux-ssh-fixture.ts` 负责只读取项目内测试连接清单、校验目标与主机密钥、创建每例独立远端目录，以及关闭自己创建的 SSH/PTY/SFTP 资源。测试仅通过该入口连接回环测试机。`tests/linux/ssh-acceptance.test.ts` 调用现有任务、策略和文件服务，并从真实服务器读取结果；测试用例不引入生产端特例。

验收目标：真实密码/密钥认证；自动和协作模式使用同一个 Linux Shell、状态与退出码正确；接管后旧租约不能继续写；中文与带替换语法参数保持字面量；真实 SFTP 文件、权限、BOM/换行往返、外部编辑冲突与磁盘空间不足不会假成功。完整产品、认证组合、UI 和发布验收范围保持不变。

来源：[QEMU 官方下载](https://www.qemu.org/download/)、[Windows 构建与校验](https://qemu.weilnetz.de/w64/)、[Alpine 云镜像](https://www.alpinelinux.org/cloud/)、[NoCloud 配置盘说明](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)。

## 已完成的实机验收（2026-09-10）

使用两次全新启动的 Alpine 测试机运行 8 项集成测试，均通过。实际环境为 Alpine 3.24.1、Linux 6.18.35-0-virt、OpenSSH、`/bin/ash`，测试账号 UID/GID 为 1000。验证包括普通私钥、加密私钥、密码和错误口令拒绝；两种任务模式的同 Shell 环境变量、目录、中文和字面量参数；旧控制租约拒绝；文件 BOM/CRLF、0640 权限与真实 UID/GID 保留；外部修改冲突；root 所有且 0700 的目录拒绝写入；1 MiB tmpfs 写满时返回失败并保留原文件。

Windows 实际应用另外通过其打包的 MCP stdio 入口连接该 Linux 测试机，发现 38 个工具并完成自动、协作两种模式。操作前由中文界面确认主机密钥和本次任务授权；未授权时命令被拒绝且远端文件不存在。协作模式逐条人工审批，审批前没有生成文件；自动模式可连续执行。相同请求重试返回相同操作 ID，实际远端文件修改时间不变。自动模式点击“立即接管”后 MCP 写入被拒绝；通过实际终端输入设置变量，再授权后 MCP 能读取该变量，证明双方使用同一个 Shell。两种任务均正常结束，应用正常退出并释放后端端口。

本机证据（均被 Git 忽略，不含在开源提交中）：

- `.cache/linux-lab/acceptance-second.log`、`acceptance-fresh.log`：两次真实 Linux 专项运行，每次 8 项通过；第二次包含加密私钥及错误口令检查。
- `.cache/desktop-observation-report-3407fc7f-156d-4338-97a3-1b7b847f9c3a/linux-desktop-result.json`：Windows、Linux、MCP 和两种模式的断言结果。
- 同目录 `linux-automatic.png`、`linux-collaborative.png` 和 `websocket-control.jsonl`：中文界面及控制权协议证据；桌面运行日志为 `.cache/linux-lab/desktop-final.log`。

### 复现方式

这些脚本只用于开发验收，不进入产品运行路径。`launch.cjs` 管理镜像校验、单次测试机身份、配置盘、网络及就绪探测；`make-seed.py` 仅生成 CIDATA；`stop.cjs` 通过 QMP 核对测试机名称后请求关机。测试帮助模块调用既有生产服务，不让业务模块反向依赖测试代码。

准备 Node 与 `app/node_modules`、Python、以下已校验的工具和镜像：

| 文件/工具                                  | 固定来源与验证                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QEMU Windows 便携目录 `.tools/qemu-11.1.0` | `https://qemu.weilnetz.de/w64/qemu-w64-setup-20260811.exe`；SHA-512 `5bcf9eed634e8575a37b74f445af41a2fe4106da512d0c30c368301d4c105037fdfab40a5287367a28a957624cddebbc8c07e16c88ab6634f554cdf3d16bf543`；解压至目录，不需要执行安装程序 |
| `.cache/linux-lab/alpine-base.qcow2`       | `https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2`；SHA-256 `6e2e6fe0572b6632527f268d3659e8fccebda4e1ee470fafe2c4d7b85b6a4df6`；启动脚本每次核对该值                    |
| Alpine 签名                                | 同镜像 URL 加 `.asc`；公钥 `https://www.alpinelinux.org/keys/tomalok.asc`；独立 keyring 验签并核对前述指纹                                                                                                                             |
| 可选的 7-Zip 解压工具                      | 官方链接的 `https://github.com/ip7z/7zip/releases/download/26.03/7z2603-x64.msi`；SHA-256 `c0680064d698a62dd4a5a47f403db356a6531a5473e4c4b1d090ea2590513926`；本机通过只读 MSI/CAB 提取，未安装                                        |
| Pycdlib                                    | `python -m pip --isolated install --index-url https://pypi.org/simple --only-binary=:all: --no-deps --target .cache/linux-lab/pydeps pycdlib==1.20.0`                                                                                  |

在项目根目录的一个 PowerShell 终端启动，设置 `TANDEM_LINUX_PYTHON` 为所用 Python 路径；如果 QEMU 在别处，设置 `TANDEM_QEMU_DIR`。启动命令会保持运行，等输出 `vmReady:true` 后再测试：

```powershell
node app/scripts/linux-lab/launch.cjs
```

另一个终端仍从根目录开始，只读取当前测试清单的路径，不打印其中的临时凭据：

```powershell
$linuxRun = Get-Content -LiteralPath .cache/linux-lab/current.json -Raw | ConvertFrom-Json
$env:TANDEM_LINUX_MANIFEST = $linuxRun.manifest
Set-Location app
node node_modules/vitest/vitest.mjs run src/backend/tests/linux/ssh-acceptance.test.ts --maxWorkers=1
Set-Location ..
node app/scripts/linux-lab/stop.cjs $linuxRun.manifest
```

未设置 `TANDEM_LINUX_MANIFEST` 时，普通测试运行会明确跳过这 8 个真实 Linux 用例；不将跳过算作 Linux 验收通过。停机后还应核对启动进程退出及该清单中的 SSH/QMP 端口释放。每次运行使用单独写入副本，基础镜像不被修改。

### 失败记录与范围

首次集成运行的 3 项失败来自测试接线：异步命令准备未等待、文档服务缺少必须的写入围栏。补齐后重新执行全部 8 项，并将磁盘写满断言收紧为实际 I/O 失败，避免泛化错误造成假通过。

首次桌面运行发现真实产品缺陷：xterm 自动回复被误认为人工接管，修复及负向验证见 [终端协议回复](57-terminal-protocol-replies.md)。修复后的两次脚本失败分别是误把外部 MCP 等待状态期望为 `running`、误把桥接连接 ID 当成配对客户端 ID；改为实际契约断言，并通过真实命令结果验证持有控制权。

本阶段证明的是上述 Alpine 场景。SSH 证书、完整 keyboard-interactive/跳板/共享凭据组合、长时间高吞吐与接管时延统计、Linux 监控和隧道矩阵仍须按原验收清单验证；Windows ConPTY 既有间歇性问题也不能据此宣布全部修复。桌面终端仍显示执行包装命令，后续界面验收需检查其可读性。

全量回归记录：`vitest run --maxWorkers=2`（同时启用真实 Linux 清单）完成 481 个测试文件，480 个通过、1 个失败；3447 项通过、3 项失败、4 项按既有条件跳过。唯一失败文件为 Windows `pty-integration.test.ts`。追踪中两项在用例等待截止后才收到命令完成标记，第三项缺失结束标记并进入暂停；这些失败保留为 `.cache/linux-lab/full-suite.log` 及 `.cache/pty-tests` 的本轮追踪，不称作全量通过，也不据此改宽断言。Linux 测试机随后经身份核对正常关机，未强制终止，PID 和两个监听端口均已释放。

独立运行 Windows PTY 套件后，8 项通过、2 项仍因等待完成超时失败（`pty-isolated.log`）。随后仅用上一提交 `4260651` 的 `SessionControl` 替换当前版本作对照，同样两项失败（`pty-baseline.log`）；对照结束通过文件哈希确认当前修改已恢复。对照只支持“这两项失败在旧控制实现也存在”，不证明第三项偶发问题或 Windows 性能已修复。没有修改测试断言、等待期限或 CI 门槛。

最终补充检查：Linux 帮助模块和用例通过单独的 TypeScript 契约检查；当前 Windows 包的 13 项原生依赖探测通过，打包 MCP stdio/Codex 初始化的 3 项测试通过。Codex 检查仅握手与工具发现，不调用收费模型，也不修改用户日常 MCP 配置。证据为 `fixture-types.log`、`native-probe.log`、`packaged-mcp.log`；最终 lint 为 0 个错误、100 个既有警告（`lint-final.log`）。
