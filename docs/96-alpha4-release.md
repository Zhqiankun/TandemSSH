# alpha.4 公开发行

2026-09-12。[Release Actions 34618278690](https://github.com/Zhqiankun/TandemSSH/actions/runs/34618278690) 全部成功，发布源码 72c42baeadad55e736609846d61178694721b7e8。公开附件由 Actions 构建上传，含 EXE、ZIP、blockmap、latest.yml 和校验和。

版本包含编辑器可见边界修复、文件修改时间随语言显示、MCP 构建版本同步以及 npm 依赖清单/九份锁定补充声明。完整回归基线 3712 项通过、15 项跳过，跳过项不算完成；云端另通过真实 ConPTY、安装升级与卸载门禁。回收站断链和 Windows 本地图像目录保存修复发生于标签之后，不在本版本中。

alpha.3 开发客户端未重定向网络，直接 GitHub 检查得到 available / alpha.4，中文截图已查看，正常退出。证据 .cache/desktop-observation-report-021043cd-e6f4-4ad5-9a64-68996fbd3f73。此为公开版本发现，不是两份公开安装包之间的原地升级证明；CI 安装升级为隔离源验证。

公开 latest.yml 539 字节，实际下载 SHA-256 5c7a4847d85f528f89b4411f5a72aa4b1cf1de476f038a8981076204244e371e。EXE 155433405 字节，实际下载 SHA-256 a8a2fb37741bfd7a3e05643cd6559b194297f28b5d96252eca3b27dd0895c703，SHA-512 与 latest.yml 一致。

下载：[Windows 安装包](https://github.com/Zhqiankun/TandemSSH/releases/download/v0.1.0-alpha.4/TandemSSH-0.1.0-alpha.4-x64.exe)；[完整发行页](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.4)。源码默认分支同步与下载说明更新需另行审阅；不声称已合入 main。完整产品目标及许可待核对项继续保留。
