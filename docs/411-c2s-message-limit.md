# C2S单消息大小上限

2026-09-14，继续F12/B13资源边界。本轮将独立C2S客户端local/dynamic、remote、测试探针以及专用后端WebSocket服务的单消息上限设为1MiB，关闭消息压缩协商。限制是消息累计大小，包含分片，不是文件/隧道总传输量。

Electron c2s-websocket-options.cjs统一客户端选项，保留原headers等配置但不允许调用方覆盖限值或开启压缩。后端c2s-relay-utils导出同值供专用服务使用；两进程保留各自依赖边界，通过契约测试核对一致，不让后端反向依赖Electron模块。主进程其他WebSocket服务不受本轮影响。

真实WebSocket双向测试：1MiB消息被接收；随后两个分片累计1MiB+1被拒绝，接收端产生payload错误，对端收到1009，业务message数量不增加。测试还验证客户端调用参数不能将上限改为无限。中文组件将Max payload size exceeded映射为可理解的超限说明，不误报成功。

消息上限/探针/中文组件共3文件18项通过；日志.cache/c2s-message-limit-final.log。主进程语法检查通过。前后端类型、修改文件规范和本地化结果另补。

本轮尚未打包验证双向完整数据传输和超限UI，不能声称所有关闭方向均显示相同详细提示；连接数量上限仍未完成。407/409流控制继续等待整包集成。整体65/79，未推送Git或触发Actions。

最终tsc -b、修改文件ESLint、本地化缺失键0通过，命令链exit0；日志c2s-message-limit-types.log、c2s-message-limit-lint.log、c2s-message-limit-localization.log。
