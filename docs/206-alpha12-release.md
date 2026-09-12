# alpha.12 公开发布与下载验证

2026-09-12，GitHub Actions 已公开开发预览 [v0.1.0-alpha.12](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.12)。源码提交 f8fdab9dfc36d18b5c4f729e0a21a30d389d3f59，Release 34682059559 第 2 次尝试，job 103525668072，最终 completed/success。

## 云端门禁与首次失败

第二次运行完整源码验证通过：4124 项回归通过、24 项跳过，11 项真实 PTY 全部通过；构建 NSIS/ZIP、原生模块、Windows 安装/在线升级/卸载、更新清单与预览发布步骤全部成功。稳定发布步骤按预览渠道正常跳过。

第一次运行在上传队列测试失败；经确定性反转哈希顺序复现，确认夹具错误假定请求到达顺序等于文件添加顺序。修正测试已在开发分支验证，见 204；发布重跑使用原不可变标签和同一生产代码，没有跳过失败用例。新测试本身不在该标签内，不混淆两者覆盖范围。

## 公开产物实际下载

Release ID 387509718，draft=false、prerelease=true。以下五个文件已从真实公开链接下载，实际大小及 SHA-256 与 GitHub asset digest 一致；三个二进制产物均与 SHA256SUMS 一致。EXE 的 SHA-512、文件大小与 latest.yml 根信息及文件条目一致。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| latest.yml | 544 | f00047d8a45bb83b01d858d4e9cd714760946fe753ebc699f5af12bbab6c165a |
| SHA256SUMS.txt | 383 | d197ecfd626ffd4ff31ebdd0cc795b943e4c7a9f327c7e2ebd207ba5b07aa7ed |
| TandemSSH-0.1.0-alpha.12-x64.exe | 155452976 | dcc10ddfd3b6cba637d1f5e9004c3df1467b261e870d1f41173f505a6a65d97f |
| TandemSSH-0.1.0-alpha.12-x64.exe.blockmap | 161939 | 11a6837cb66ef8b2dadc294ff2ba266184ae87c39a5eda0f9703f27ff9e2e01a |
| TandemSSH-0.1.0-alpha.12-x64.zip | 208288237 | 96b898d26b897e6fc92aa767ef44039899dc778a53f723ddec79f720d802f7fe |

报告 `.cache/alpha12-download-verification.json`；下载校验脚本退出码 0。安装包均由 Actions 构建上传，本地没有替代上传。

## 旧客户端发现新版

保留的 alpha.4 开发目录客户端在全新隔离配置中，连接真实 GitHub 更新源，未重定向网络，显示 available / alpha.12；automaticChecks=true、checkIntervalMinutes=20。报告 `.cache/desktop-observation-report-fb855956-5bbe-4a62-882d-341517f70aae/public-alpha-update-result.json`，更新截图已查看，客户端和观察器正常退出。

这证明公共新版发现和检查设置，不冒充在该旧开发目录执行安装升级或等待了实际 20 分钟；真实安装升级由上述云端门禁单独覆盖。

## 仍为开发预览

alpha.10/11 没有公开安装包；alpha.12 包含终端启动输入和模型 Key 字段加密修复。字段层与外层整库加密的区别见 202、205。完整产品验收、模型 Key 会话内存选项及其他既定剩余项仍未完成。main 不在本次变更范围，继续保留此前获批提交；新发布以不可变版本标签提供源码与安装包。
