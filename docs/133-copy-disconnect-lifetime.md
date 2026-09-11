# 复制请求断开后的生命周期

2026-09-12，延续文档 132，属于 alpha.6 标签之后的开发修复。

复制路由接入 req.aborted 与 res.close，按既有文件路由模式区分未完成 HTTP 断开和正常响应结束。断开时复用过期标记阻止 queued execChannel 的 beforeOpen，清理 60 秒计时器及请求/响应监听，关闭已取得的 SSH 通道。若通道回调在断开后才返回，立即关闭，不再处理其成功输出。已开始的远端程序可能仍产生副作用，不声称回滚。

20 项 copy-route 回归通过，新增真实 EventEmitter 请求中止、响应断开、正常完成场景。测试断言未完成请求不会发送成功响应、排队 guard 拒绝、通道关闭、正常完成不 destroy、请求与响应监听数量归零。ESLint 无错误。这里是服务端 HTTP 生命周期测试，不代表界面每个关闭按钮都已接入 AbortSignal，也不冒充真实网络故障实机验收。

依赖方向与模块责任不变：action-routes 对接 HTTP 和 SSH 通道，复用 session.execChannel。公开 alpha.6 源码标签保持不变。
最终 tsc -b 类型检查通过。
