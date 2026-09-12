# alpha.14 已公开发布

源码标签 v0.1.0-alpha.14，提交 3b11d8c77af4895febcdd6bb47d3e0a3daba289c。Release 运行 34694261681、Windows job 103554906390 已 completed/success。Release ID 387572999，draft=false、prerelease=true。

[发布页](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.14)

## 云端门禁

Actions 实际完成锁定依赖安装、类型/规范/汉化、源码回归、真实 PTY、Windows EXE/ZIP 构建、原生模块，以及真实安装/在线升级/卸载/数据保留门禁。所有必需步骤成功；稳定发布分支按预览渠道正常跳过。

源码 573 文件通过、13 文件跳过；4236 项通过、24 项跳过，290.62 秒。独立 PTY 11 项通过，94.90 秒。安装结果 installed/native/desktop/upgraded/uninstalled/dataPreserved 均为 true，failures=[]。

alpha.13 因干净检出的测试缓存目录缺失未发布安装包，原标签保留；本版纳入 1b187af 修复后完整运行门禁，没有跳过测试。

## 公开资产实际校验

以下五份文件均从公开 Release 实际下载，大小及 GitHub SHA-256 一致。latest.yml 的版本、EXE 大小及 SHA-512 一致；SHA256SUMS 覆盖 EXE、blockmap 和 ZIP 且匹配。机器记录 .cache/alpha14-download-verification.json。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 544 | 1d6fd388a25f319063d61935721ca4ec799e8ef34f53c8e31a20da6bd233abfb |
| SHA256SUMS.txt | 383 | b337c1f00926e4f5cf94092e73f26a750e71b7411e89244e23a69893a1275ba2 |
| TandemSSH-0.1.0-alpha.14-x64.exe | 155457437 | 073b6c27a43fe8626964db995e0cdeb868edd6cc5e437b7fd6db00993c8ca7c6 |
| TandemSSH-0.1.0-alpha.14-x64.exe.blockmap | 162085 | f7f9646dc603d2dd981235ec411b195ab3de21655cdae820135603e1ae0794fc |
| TandemSSH-0.1.0-alpha.14-x64.zip | 208301549 | 0b82fb456c0494a45254dcd59a2d3fe3dd9a2cb858b43d26ebdabac27a3658ac |

匿名 GitHub API 请求出现限流后，使用已有 GitHub 连接器成功读取同一公开 Release 元数据；文件仍从公开下载地址获取，没有提取或导出 GitHub 凭据。

## 旧客户端发现新版

保留的 alpha.4 开发目录客户端在独立配置中，通过真实 GitHub 源检测到 alpha.14，status=available、automaticChecks=true、checkIntervalMinutes=20。报告 .cache/desktop-observation-report-4ee8ca12-904d-4166-8a6b-b095b29e1d2a，public-alpha-update.png 已查看，客户端正常退出。

该客户端 installed=false，证明实际版本发现和周期设置，不是本机执行安装版升级，也没有等待整整 20 分钟。真实 NSIS 在线升级由上述云端门禁单独证明。

## 当前范围

聊天历史、未完成片段、分页、并发及 MCP 修复见 75-preview-release-notes.md。仍为开发预览，完整产品目标未完成；流程秘密参数、部分认证/监控/设置及其他资源边界继续保留。

0aef1b7 的本地界面偏好启动保护晚于发布标签，不包含在 alpha.14 安装包内。main 未因此合入后续开发分支。
