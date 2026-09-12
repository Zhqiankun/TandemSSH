# alpha.9 公开发布与更新源验收

2026-09-12。v0.1.0-alpha.9 已由 GitHub Actions Release 34670815850（job 103491704836）构建并公开发布，源码 9d38a2faac967ccfec7f0c7228c8eae1b5b65a1d。Release completed/success，源码、真实终端、原生模块、Windows 安装/在线升级/卸载等必过门禁通过。

发布页：https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.9
安装包：https://github.com/Zhqiankun/TandemSSH/releases/download/v0.1.0-alpha.9/TandemSSH-0.1.0-alpha.9-x64.exe

公开元数据 draft=false、prerelease=true。EXE、ZIP、blockmap、latest.yml、SHA256SUMS.txt 均存在。安装包 155450737 字节，SHA-256：
1b1480cc2c4788b2eddcaacf58196272dd146ffc78eaa772fde9bc08c8ef7388

## 下载和发现的直接证据

实际下载 EXE、latest.yml 和 SHA256SUMS，均匹配 GitHub 附件 SHA-256；清单版本、EXE 的 SHA-512 和大小一致，SHA256SUMS 中的 EXE 条目一致。报告 .cache/alpha9-download-verification.json。ZIP/blockmap 此轮只核对公开元数据，不声称已本机完整下载验证。

保留的 alpha.4 开发目录客户端在新临时配置下，从真实 GitHub 源发现 alpha.9，没有网络重定向。报告 .cache/desktop-observation-report-8adaffc6-7ee1-4399-bc73-682386c2d5dd，public-alpha-update.png 已实际查看；中文界面显示当前 alpha.4、可用 alpha.9、每 20 分钟检查，正常退出。此处验证公开发现；实际安装版升级由云端门禁验证，不混称为本机旧安装版升级。

## 范围和限制

本版包括 180 的本地终端起始目录/CMD/本机标识、181 的文件目录终端路径保护，以及此前回收站恢复协议、sudo 密码与中止保护、批次部分失败改进。183 的同一 PTY 可信 cwd 查询发生在标签之后，不包含于 alpha.9。

发布前完整重跑 4020 项通过、23 项专项环境跳过、零失败和未完成。首次回归曾出现非 Windows Shell 兼容回退失败（已修复）和一次 Node 原生清理钩子断言；单独上传测试、完整重跑及本次云端门禁均通过，原生断言原因尚未确定，首次日志保留于 .cache/alpha9-first-regression-failure.log。

完整原始产品范围仍在继续验收，不因预览发布视为全部完成。公开安装包由 Actions 生成和上传；本机没有代为构建上传。main 仍保持已获明确批准的历史提交，下载说明更新于开发分支。