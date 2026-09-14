# 新增未知命令分类的打包桌面验证

2026-09-14。将375的生产分类修复重新构建到本地 Windows 目录包，未发布。

## 实际中文试算

独立 Windows 客户端连接本轮隔离 Alpine SSH，中文窗口核对主机指纹，打开协作执行中的命令黑白名单。逐项将程序规则设为 allow，试算 awk、gawk、mawk、nawk、busybox、ash、deno、deno2.1、busybox.exe。

每项普通模式显示“需要人工审阅”且不显示“规则允许”；勾选严格模式后显示“规则拒绝”。每轮后端已保存规则与初始快照逐字比较一致，整个矩阵前后任务列表也一致。仅验证试算与草稿行为，不声称实际运行了这些解释器；自动/协作派发拒绝的双模式证据见375。

原始报告 .cache/desktop-observation-report-aaf07976-aa44-495a-8566-cb186a5b598c/opaque-trial-result.json 已读取，九项全部通过。保存 opaque-strict-deny.png；中文可见性来自实际 DOM 断言。脚本 opaque-trial-observer.cjs、run-opaque-trial.cjs，日志 opaque-trial-native.log。客户端正常退出、脚本exit0、业务端口释放；夹具远端目录清理。

## 构建与运行时

源码 build、electron-builder --win --dir --publish=never 成功，日志 opaque-desktop-build.log、opaque-desktop-package.log。构建保留既有大 chunk 警告。

完整 verify-native-package 检查由于目录包缺少 resources/app-update.yml 未通过，日志 opaque-native-probe.log；不修改校验脚本或补造更新文件。此轮目录包不能代替最终安装器与在线更新验收。

随后单独以打包 EXE 的 --probe 模式验证运行时。初次 PowerShell 调用未捕获报告，不能以其返回码判定通过；改用 spawnSync 等待并要求明确报告后 exit0。日志 opaque-native-runtime-result.log：dependenciesVerified=13，SQLite、serial、keyring、PTY、文件/目录能力和目录恢复均true，Electron43.2.0，ABI148。

Linux实例5149e7b1-45df-434c-97cd-1a70022cae5a结束后关机超时，forced=true，启动器exit0；不是正常OS关机。日志 opaque-linux-launch.log、opaque-linux-stop.log。

A12仍不标记完全验收：程序名分类不证明远端任意改名程序或符号链接的真实行为。整体60/79。没有Git推送、标签、Actions或安装包上传。
