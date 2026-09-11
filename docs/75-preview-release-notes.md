# TandemSSH Windows 开发预览

同舟 SSH 是 Windows 优先的人机协作 SSH 工作台，基于 Termix 改造。模型使用你自己的接口地址和 API Key；核心 SSH、协同和 MCP 功能不要求本软件会员。

## alpha.5 本次更新

- AI 交还控制权后可读取最近的人工终端输出；已知秘密会脱敏，输出有长度上限并标记为非可信数据。Windows / 真实 Linux SSH 的自动和协作模式已完成专项验证。
- 修复切换会话时旧请求覆盖当前任务列表、接管状态相互影响的问题；命令和模型上下文仍绑定原会话。
- MCP 在人工接管后明确返回控制权失效错误，并提供中文停止写入提示。
- 修复回收站中的断链被误判为丢失、还原时可能覆盖既有断链的问题；修复 Windows 本地图片存储目录无法按原生路径保存的问题。
- 保留内置更新按钮和每 20 分钟自动检测，由 Actions 同步发布 latest.yml、安装包及校验文件。

仍为开发预览，完整产品验收继续进行。alpha.1 及之后的安装版可在软件内检查新版；alpha.0 需手动安装一次当前版本。验收记录见 docs/94-trash-link-retention.md、docs/95-windows-image-storage-path.md、docs/97-mcp-control-errors.md、docs/102-windows-ai-handback.md、docs/103-workbench-session-isolation.md。

## 下载与启动

- `TandemSSH-版本号-x64.exe`：Windows x64 安装程序，推荐使用。
- `TandemSSH-版本号-x64.zip`：免安装包，完整解压后运行 TandemSSH.exe。
- `SHA256SUMS.txt`：安装包、免安装包和 blockmap 的 SHA-256 校验值。
- GitHub 自动附带的 Source code ZIP/TAR 是源码，不能直接安装。

## 可以试用

SSH 终端、文件上传下载与在线编辑、自定义多步流程、命令规则、AI 自动执行与人机协同、随时人工接管，以及 Codex 等客户端的 MCP 接入。客户端隧道支持本地、远程和 SOCKS5 模式，无需远程同步服务器；旧隧道配置需重新选择主机。

模型在使用前自行配置；MCP 在用户资料中配对并选择可访问主机。建议先在测试服务器体验，再决定是否用于实际工作。

## 当前边界

这是开发预览，完整产品验收仍在进行。文件权限/链接与项内恢复、完整认证和重连矩阵、部分监控与设置、全界面汉化及历史版本迁移仍有待完成或补齐验证。

从 alpha.1 起，安装版支持预览版内置更新：启动时检查，运行期间每 20 分钟检查一次；发现新版后提示，下载和重启安装由你点击。可在设置中关闭自动检查，手动检查仍可用。alpha.0 缺少这套预览更新逻辑，需要手动安装一次当前版本；之后可使用内置更新。免安装版通过发布页更新。每个新版本的 latest.yml、安装包和校验文件由 Actions 一起发布。

源码和验收范围见仓库 docs/70-acceptance-baseline.md、docs/74-standalone-c2s.md。项目与底座许可证随包位于 resources/notices；预览发布不代表所有第三方资源清单和最终产品验收已经完成。
