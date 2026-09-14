# 高级配置摘要与停用状态的桌面验证

2026-09-14，将381的预览分类打入本地Windows目录包，并验证导入后状态。无新增生产代码。

独立客户端原生JSON文件输入复测missing/ambiguous/valid三类凭据引用，每类先取消再确认。测试文件同时携带九类配置，显式开启enableTunnel、enableDocker、enableProxmox、enableTmuxMonitor、采样和隧道autoStart，代理密码与快捷命令使用独立canary值。

六次原生确认框逐项断言包含全部九类中文名称与“不代表已启用”说明，均不包含代理密码或快捷命令canary。此前凭据拒绝/明确ID成功及取消不写入场景再次通过。

成功导入后读取实际主机API：上述后台开关均关闭、metricsEnabled/statusCheckEnabled=false、disableTcpPing=true、每条隧道autoStart=false；tandem会话列表为空，没有自动打开终端。此证据检查保存状态和终端资源，不等同于监控宿主全部网络流量，也不证明覆盖导入会如何处理已有运行中隧道。

原始报告.cache/desktop-observation-report-9184cce2-6190-47d5-a935-ffe9553d5c4a/advanced-import-result.json已读取，全布尔断言通过。credential-import-result.json记录三类引用结果。脚本advanced-import-observer.cjs、run-advanced-import.cjs；日志advanced-import-native.log。客户端cleanExit=true、脚本exit0，业务端口释放。没有连接外部SSH或真实模型。

build和electron-builder目录打包通过，日志advanced-import-build.log、advanced-import-package.log。当前本地包包含381预览及377—380凭据/错误展示修复，公开安装包未改变。未推送Git、未触发Actions。

A22仍未完成：类别摘要不代替字段值/覆盖差异审阅，运行中资源影响和预览绑定边界仍需推进；整体60/79。
