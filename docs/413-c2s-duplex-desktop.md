# 当前桌面C2S双向大数据集成

2026-09-14，将407/409双向流控制与411/412消息上限/关闭原因构建到本地Windows目录包。本轮无新增生产修改。

沿用405真实桌面取消流程，最后明确重试后通过本地监听端口发送中文前缀、空字节及8MiB+7字节二进制payload。数据经真实TCP→Electron WebSocket→后端SSH转发→本轮固定Echo服务，再沿反向链路返回。对全部接收字节进行Buffer.equals及SHA-256记录，结果一致；总量大于1MiB，证明单消息限制没有被错误实现成总传输限制。

报告.cache/desktop-observation-report-3e518109-1ed3-4eb5-9dcb-12b5fd39a5ec/c2s-large-echo-result.json已读取。完整监听前取消、30次立即停止、认证挂起取消、注销及明确重试流程通过；不是仅运行脱离主进程的泵单元测试。脚本run-c2s-flow.cjs复用c2s-description-observer.cjs；日志c2s-flow-desktop.log。

客户端cleanExit=true、脚本exit0，暂停点恢复、SSH/Echo与业务端口清理。build与目录打包通过，日志c2s-flow-build.log、c2s-flow-package.log。公开安装包未更新，未推送Git或触发Actions。

本轮是单条local隧道全链路完整性，不宣称慢消费者全局内存曲线或remote streamId全矩阵已完成。代码复核还发现后端local/dynamic二进制桥尚未复用远程通道已有的背压工具，连接数限制也待补齐；这些不因本次快速回显通过而消失。整体65/79。
