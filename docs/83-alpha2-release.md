# alpha.2 公开发行

2026-09-11。[Release Actions 34521928257](https://github.com/Zhqiankun/TandemSSH/actions/runs/34521928257) 全部成功，发布源码 e9e6f422a9c99cf909cd727673f3f3e3e02a31b4，已快进主分支。所有公开二进制由 Actions 构建上传，未上传本地开发包。

[公开发布页](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.2) 包含 EXE、ZIP、blockmap、latest.yml 和 SHA256SUMS.txt。主要改动：任务/保留历史脱敏导出与取消；中文来源、主机/会话、策略、退出码和输出摘要；生命周期记录补齐；Unix 目录与特殊权限位修复。符号链接修复发生在标签之后，不包含于此版本。

源码检查、原生模块验证，以及真实 Windows 安装、隔离升级、卸载和数据保留门禁全部通过。实际 alpha.1 开发目录包未改写网络，直接访问 GitHub 后显示 available、最新版本 alpha.2，automaticChecks=true、间隔 20 分钟，正常退出。已查看中文截图；报告 .cache/desktop-observation-report-401b2775-b4c6-4cd4-873b-f877dc137f90/public-alpha-update-result.json。该观测为目录包的公开更新发现，不代表实际安装版完成 alpha.1 → alpha.2 原地升级；CI 安装升级使用隔离源。

latest.yml 539 字节，下载文件 SHA-256 为 2c60d682bc04998ecdd4d3cfcb5a85854577b6081319d126b365a0a44e8fefbb，与 GitHub 附件 digest 一致。公开 EXE 155358095 字节，GitHub SHA-256 为 dbc1bb98e7efdf549538063da61b2ffd928f0bb9bedbb76cbeaa36d0d5874bd1。

完整产品目标继续推进；此开发预览不等同于全部验收完成。

实际公开 EXE 已下载并校验：大小、SHA-256 与 GitHub digest 一致，SHA-512 与 latest.yml 一致。该证据验证公开附件下载完整性，未在本机安装程序。
