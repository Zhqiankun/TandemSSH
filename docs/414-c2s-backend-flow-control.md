# 后端C2S二进制通道背压

2026-09-14，接续413发现的后端缺口。

c2s-relay-utils新增sendC2SBinary，二进制帧沿用现有远程控制帧的WebSocket高低水位机制；超高水位暂停SSH来源，降到低水位才恢复，来源关闭或WebSocket关闭后清除恢复计时器。发送回调错误销毁来源。

原writeC2SRemoteChunk更名writeC2SStreamChunk，以准确表示现已用于各模式SSH流写入；local/dynamic不再直接outbound.write，而复用既有队列阈值检查、WebSocket.pause及drain恢复。remote调用同步更新，无第二套写入限制规则。现有阈值在追加前检查，可能叠加当前消息大小，不宣称精确8MiB硬内存上限。

隧道工具模块继续拥有流控制，relay只编排，未增加无业务归属共享层。Electron双向泵保持自己的进程边界，不被后端导入。

新增缓冲高低水位、销毁不复活和过载不追加测试，与真实隧道矩阵共2文件65项通过；tsc -b与三处文件ESLint通过。日志.cache/c2s-backend-flow-tests.log、c2s-backend-flow-types.log、c2s-backend-flow-lint.log。新增水位测试为可控流/定时器验证，真实三模式数据回归分别承担连接集成证据。

本轮后端改动尚未重新打包，连接数上限仍待补齐。整体65/79，未推送Git或触发Actions。
