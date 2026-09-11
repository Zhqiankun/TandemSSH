# alpha.5 Actions 发布与公开更新验证

2026-09-12，v0.1.0-alpha.5 已由 [Release Actions 34627135287](https://github.com/Zhqiankun/TandemSSH/actions/runs/34627135287) 成功构建发布，源码标签 7cfb1c6fdbaf4ee2b13521c58c5af3943c37e036。包括源代码检查、ConPTY、构建、原生模块、安装/升级/卸载及清单生成门禁；未用本地包替代发布。

[下载开发预览](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.5)。公开状态 draft=false、prerelease=true。附件：latest.yml 539 字节、SHA256SUMS.txt 380 字节、EXE 155435393 字节、blockmap 162633 字节、ZIP 208267093 字节。

实际下载 EXE 的 SHA-256 为 18c0b5b31dc49736230fa84f947ce956480e2ed7e4ef0ca4b3273cebb388e90d，与 GitHub 资产摘要一致；SHA-512 与 latest.yml 一致，清单版本及大小一致。验证 .cache/alpha5-download-verification.json。

保留的 alpha.4 开发目录客户端访问真实 GitHub 发布源，检测到 alpha.5，显示中文更新提示及每 20 分钟检查说明；截图已经查看，应用正常退出。证据 .cache/desktop-observation-report-72208334-8b4f-42cd-9c5a-b9ba0722ebe5/public-alpha-update-result.json、public-alpha-update.png。网络未重定向。此项是公开新版发现，不冒充两个公开安装包间的本机覆盖升级；Actions 的安装升级另用受控更新源验证。

alpha.5 包含终端上下文衔接、MCP 接管错误、跨会话工作台、回收站断链、Windows 图片目录修复。后续新增的验收记录和测试不改变已发布标签；完整 79 项范围继续验收，预览发布不代表全部完成。
