# alpha.3 公开发行

2026-09-11，[Release Actions 34528020282](https://github.com/Zhqiankun/TandemSSH/actions/runs/34528020282) 全部成功，源码 19d778082a29fda5c58428bab0ff503663b9593c 已同步主分支。公开二进制均由 Actions 构建，包含完整源码检查、原生验证和实际 Windows 安装、隔离升级、卸载与数据保留门禁。

[公开发布页](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.3) 包含 EXE、ZIP、blockmap、latest.yml 和校验和。修复 alpha.2 列表特殊权限位遗漏和符号链接完整路径处理，新增中文所有者/组修改及读回确认。浮动编辑器边界修复发生于标签之后，虽已通过后续实机验证，尚未包含在本版本。

保留的 alpha.2 开发客户端已核对 ASAR 版本；未改写网络，直接 GitHub 检查得到 available / alpha.3，中文界面截图已查看，正常退出。证据 .cache/desktop-observation-report-c626803d-6d27-47c1-9568-3983e4793a2b。初次观测被脚本只接受原构建目录的检查拒绝，改为精确验证自有保留目录和包版本后通过；未修改产品更新逻辑。此为目录包的公开版本发现，不是两份公开安装包之间的原地升级证明。

latest.yml 实际下载 SHA-256：f914b98e7597bd1e66b86e4aed6399fe31c16ec5968dd976a0aa76890374c1ff。公开 EXE 155360717 字节，实际下载 SHA-256：ef92c3850b903ca23f91299f32fe701c837cd61743cb7919bb59863bdc235487，且 SHA-512 与 latest.yml 一致。

项目完整目标继续推进，本发行不是最终完整验收。
