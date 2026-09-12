# B11 文件联动验收归并

2026-09-12，按 docs/09-base-features.md 的原始 B11 四项标准归并，当前源码的 B11 标为 verified；不代表全项目验收或已发布安装包同步更新。

| 原始标准 | 实际证据 |
| --- | --- |
| 复制远端路径 | Windows 桌面文件菜单点击复制路径，随后通过同一应用的 Electron 原生 clipboard.readText 核对为 `/resume.bin`，与远端路径完全一致。 |
| 在此目录打开终端 | 文档 187：真实 Alpine OpenSSH，中文及单引号目录的右键打开终端后，pwd 写入证明文件，SFTP 独立读取结果与选中目录一致。 |
| 可信 cwd 跟随 | 文档 187：独立终端人工 cd 后，从终端工具栏确认空闲 POSIX Shell 目录查询，文件面板打开实际子目录。文档 183、185 另覆盖控制权、代次及请求生命周期；187 修复实际 WebSocket data 封装缺陷。 |
| 打开本地下载目录 | 当前 Windows 客户端实际完成 65539 字节 SFTP 下载并核对 SHA-256，点击打开所在目录后，用 Windows Shell.Application 读取实际资源管理器窗口：目录与独有测试目录完全一致，SelectedItems 包含“下载 文件.bin”。随后仅关闭这个独有测试目录的窗口。 |

## 本轮报告

源码 ad9cdeb 的本地 build 和 electron-builder --win --dir --publish=never 成功。

报告目录：`.cache/desktop-observation-report-45b72811-f608-442b-bc4f-0f81b39e2e1f`。

- `file-links-result.json`：系统剪贴板路径、文件哈希、实际资源管理器定位、中文错误提示、完成状态全部通过。
- `explorer-result.json`：实际目录与选中文件的完整路径。
- `download-reveal-missing.png`：已查看，确认下载仍完成；截图时旧成功提示遮挡新提示，因此中文失败提示以观察器对真实 DOM 的断言为证，不把截图当作该提示的证明。
- 将本次下载目标改名后再点击定位，真实页面出现独立中文失败提示，下载状态仍为已完成。
- 客户端正常退出、后台端口释放，观察器退出码 0；SFTP 夹具已关闭。

执行：`node --import ./app/node_modules/tsx/dist/loader.mjs .cache/run-file-links-desktop.cjs`。初次未加载 tsx 的命令因测试夹具的 .js 导入解析失败，未启动客户端；使用项目加载器后通过。启动脚本仅自动选择独有下载目标；真实传输、原生剪贴板和资源管理器定位均未替换为 mock。回环 SSH/SFTP 使用真实协议与受限本地文件系统；它不是 Linux 权限验证（Linux 双向目录验证另见 187）。

## 边界

此处“可信 cwd”仍是明确确认空闲 POSIX Shell 后的主动查询，不承诺自动识别 vim/top，也不声称支持任意 Windows SSH Shell。浏览器剪贴板异常回退见 188。公共 alpha.9 不含后续目录查询协议与剪贴板修复，后续由 Actions 发布新版本。
