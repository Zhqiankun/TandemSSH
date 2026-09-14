# S2S断线后自动重连与数据回传

2026-09-14，继续F12/B13。本轮只增加测试，不修改生产代码。

在既有真实SSH矩阵夹具上配置S2S local、maxRetries=1、retryInterval=100ms。人工确认主机信任后建立连接，保存原Client对象，服务端关闭已连接客户端。等待当前Client换为新对象且状态connected=true，再通过实际监听端口发送包含中文和空字节的payload，逐字节回显一致。

没有新增主机信任提示。手动停止后数据socket关闭，activeRetryTimers与activeTunnelRuntimes无该隧道；最终由既有夹具清理监听和SSH服务。原maxRetries=0断线后不重试用例保留。

隧道测试全62项通过，日志.cache/s2s-retry-data-tests.log。这是实际回环SSH/TCP数据验证，不是观察到状态connected就判恢复，也不是新的原生桌面重连录像。服务端S2S的重试能力与404说明的独立C2S行为分别对应。

不将此单主机local用例推广为所有双跳和认证组合自动重连。模块责任、依赖方向均未改变。F12/B13继续归并原始范围，整体65/79。未推送Git或触发Actions。

最终tsc -b及修改文件ESLint通过，命令链exit0；日志s2s-retry-data-types.log、s2s-retry-data-lint.log。
