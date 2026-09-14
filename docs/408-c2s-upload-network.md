# C2S上传流控制的真实网络验证

2026-09-14，验证407新增上传泵，本轮只新增测试。

实际回环TCP发送端向上传泵提交1MiB+7字节二进制payload，上传泵连接真实WebSocket服务。等待ready期间观察40ms：WebSocket接收0字节、TCP不处于flowing，readableLength不超过其highWaterMark加一个64KiB接收块；不声称这等于整个进程或OS socket内存上限。

成功场景调用start，先发送中文/空字节前缀，再传payload；接收总长度和SHA-256逐字节序列对应。取消场景先close再start，仍无数据发送、读取保持暂停。既有受控回调测试补充写回调串行、错误与迟到回调不恢复读取。

两文件5项通过，日志.cache/c2s-upload-network-final.log。真实TCP/WebSocket监听与连接均在finally清理，完成后清除测试deadline；不依赖open事件一定尚未到达。不是原生Electron桌面压力测试，也不覆盖反向数据或远程streamId通道。

无新生产模块或依赖变化，407生产改动尚待打包集成。F12/B13资源边界继续推进，整体65/79。未推送Git或触发Actions。

最终tsc -b及新增测试ESLint通过，命令链exit0；日志c2s-upload-network-types.log、c2s-upload-network-lint.log。
