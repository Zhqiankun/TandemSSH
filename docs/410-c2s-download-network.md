# C2S下载方向真实WebSocket/TCP验证

2026-09-14，接续409，本轮只新增网络测试。

建立真实回环WebSocket服务与TCP连接，用TCP cork确定性暂停实际写出，而不是依赖操作系统缓冲恰好变慢。通过WebSocket发送1MiB+9字节二进制帧，实际下载泵触发WebSocket.pause；TCP接收0字节，writableLength等于该帧长度。解除cork后，TCP接收完整长度，SHA-256一致，正常路径恢复读取一次。

取消场景在背压期间关闭泵，再排空此前已接受的TCP写入；WebSocket.resume次数仍0，drain监听移除。此测试验证取消后不恢复读取，不声称已交给TCP的字节能够撤回；产品外层cleanup另负责destroy连接。

下载真实网络、下载泵与上传真实网络共3文件7项通过。tsc -b与新增测试ESLint通过；日志.cache/c2s-download-network-tests.log、c2s-download-network-types.log、c2s-download-network-lint.log。所有监听与socket在finally关闭。

没有新增生产模块或依赖变化，不冒充原生Electron全链路压力测试。单帧限制、并发连接上限及407/409打包集成仍待处理，整体65/79。未推送Git或触发Actions。
