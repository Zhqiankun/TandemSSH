# B16 本地终端：Shell、起始目录与本机标识

2026-09-12。回到原始 09-base-features / B16 核对，发现原本地终端固定 os.homedir，缺少起始目录入口；切换 Shell 还会立即重建进程。本轮完成该需求，未将其他文件操作剩余边界据此标记完成。

## 实现与责任

electron/local-shell.cjs 负责受支持 Shell 和目录验证：Windows 默认 Shell、CMD、WSL；CMD 使用 ComSpec 或 cmd.exe，参数与路径作为独立参数处理。起始目录留空兼容原用户主目录，非绝对路径/含 NUL 拒绝，目录不存在或不可访问拒绝；成功返回规范化目录。

main.cjs 将验证后的 cwd 传给 pty.spawn，并返回真实 Shell 路径和起始目录；electron.d.ts 扩展既有 IPC 类型，preload 仍透传原接口，不新增通用执行入口。

LocalTerminal.tsx 增加常驻“本机终端”标识、实际 Shell/起始目录、目录输入和显式启动/重启按钮。修改输入不自动关闭进程；点击“按新设置重启”才生效，旁边说明会关闭当前 Shell。启动失败显示中文错误，不静默换目录。进程退出信息汉化，语言变化不作为重启依赖，失效异步回调不更新新会话状态。

无新增外部依赖或跨业务共享模块；主进程负责目录与进程，页面只编排启动和显示反馈。WSL 沿用已有入口，此次未安装或实测 WSL 发行版；Windows 本机 PowerShell/CMD 是本轮 B16 验收对象。

## 验证

参数与 React 组件两个文件 4 项测试通过，覆盖 Shell 白名单、默认目录、文件/相对路径/不存在目录拒绝、中文和特殊字符路径字面值、编辑不重启、显式提交传参、关闭原会话和无效目录错误。tsc -b、相关 ESLint、中文缺失键检查通过。

真实 Windows Electron + 原生 PTY 报告：
.cache/desktop-observation-report-08634703-885d-4243-a146-b5be33eac2fc/local-terminal-result.json

通过实际终端输入命令写入隔离报告文件，核对默认 PowerShell 的工作目录等于用户主目录；切换 CMD 后，其子进程报告的目录等于指定的“中文 ' $(literal)”目录。Shell 参数中未拼接 cwd。指定不存在目录后出现中文拒绝提示，没有默认目录回退。local-cmd-directory.png 已实际查看，本机标识、CMD 和目录输入可见；应用正常退出，观察器进程退出 0。没有连接业务 SSH 主机或修改日常应用配置。

第一次桌面观察因测试脚本控件查询引号错误失败（报告 7883e7f7-01e2-4c1e-94ea-2cd7bc86d1d9）；修正查询后新配置全流程通过。初期 React 测试的 i18n mock 与 matcher 不兼容已修正，不作为产品失败。

按原始 B16（Windows 本机 Shell、Shell 选择、起始目录、与远端明确区分）标记已验证。完整项目及其他编号仍保持原范围继续验收；公开 alpha.8 不包含本轮起始目录入口和 CMD 改造。