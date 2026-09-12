# alpha.8 公开发布与更新源验收

2026-09-12。v0.1.0-alpha.8 已由 GitHub Actions Release 34661502595（job 103464778590）构建并公开发布，源码为 880fcadeecde81755db9d6bf4aacfd70b2c8a286。Release completed/success；源码、完整应用与真实终端、原生模块、Windows 安装/在线升级/卸载门禁全部通过。

发布页：https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.8
安装包：https://github.com/Zhqiankun/TandemSSH/releases/download/v0.1.0-alpha.8/TandemSSH-0.1.0-alpha.8-x64.exe

公开元数据 draft=false、prerelease=true。附件包含 EXE、ZIP、EXE.blockmap、latest.yml 和 SHA256SUMS.txt。EXE 大小 155438380 字节，SHA-256：
865ca8e8944bbbcfec4384738236332e925cdcf238afbb8c3e091f0b750e964e

## 实际公开下载与发现

已从公开 URL 实际下载 latest.yml、SHA256SUMS.txt 和 EXE，分别匹配 GitHub 附件摘要；清单 version 为 0.1.0-alpha.8，SHA-512 与 size 匹配安装包，SHA256SUMS 对应条目一致。机器证据 .cache/alpha8-download-verification.json；本轮没有重复下载 ZIP 或 blockmap，因此不把其服务端摘要等同于本机完整下载验证。

保留的 alpha.4 开发目录客户端使用新临时配置，从真实 GitHub 源发现 alpha.8，未重定向网络。报告 .cache/desktop-observation-report-c91d5c39-cd89-4f67-9958-a34b702dbed3/public-alpha-update-result.json；public-alpha-update.png 已实际查看。当前版本 alpha.4、可用版本 alpha.8、automaticChecks=true、checkIntervalMinutes=20，客户端正常退出。该本机专项验证的是公开发现；实际安装版升级由上述 Actions 门禁证明，不能将开发目录包声称为已在本机安装升级。

## 本版范围与后续改动

本版包含 155 的 MCP 并发提议重试修复、160 的复制不覆盖/不合并目录、161 的删除会话切换停止，以及已知 TUI 程序审查和历史日期语言修复。发布前本地完整应用回归 3937 项通过、21 跳过、零失败；专项环境跳过不作为本轮通过证据。

标签固定后完成的 163 回收站未知结果分类和 164 双栏回收站入口/中文确认修复，不包含在 alpha.8 安装包中，仍在开发分支。完整原始产品目标、秘密流程输入方案、批量异常桌面矩阵和第三方声明清单仍继续推进；本次预览发布不代表全部验收完成。

本机没有构建上传公开 EXE。README 下载区更新在开发分支，main 仍保持用户已批准的 alpha.4 快进提交。