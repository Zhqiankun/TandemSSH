# C2S 主机查询阶段取消

2026-09-14，继续F12/B13/A35。本轮只扩展隧道测试夹具与断言，生产代码未改变。

对test、local、dynamic、remote四种中继请求分别建立真实WebSocket连接和可计数的SSH服务。将主机解析返回值挂起，先等待明确的查询进入计数，再关闭客户端WebSocket，等待服务端close事件后放行查询。

实际handleC2SRelayTest/handleC2SRelayOpen返回TUNNEL_CONNECTION_CANCELLED。SSH连接、认证、转发计数均0，主机信任提示为空。关闭连接发生在异步查询期间，不是仅在请求开始前取消。测试finally释放查询、恢复夹具状态并清理本轮监听。

隧道信任/生命周期与代理取消共2文件53项通过；日志.cache/c2s-lookup-cancel-final.log。首轮也通过，但缺少“已进入查询”的明确等待；增强该前提后重跑通过，不将首轮弱时序证据作为最终结论。

模块边界未变：中继函数拥有WebSocket→AbortSignal生命周期，主机解析通过既有resolver，真实SSH夹具负责连接/认证/转发计数，无新共享模块。

本轮覆盖后台中继的极早取消，不等于Electron主进程本地端口监听前窗口已完成桌面验收，也不替代完整权限撤销/运行资源矩阵。原始条目保持未完全验收，整体64/79。未推送Git或触发Actions。

最终tsc -b与修改文件ESLint通过，命令链exit0；日志c2s-lookup-cancel-types.log、c2s-lookup-cancel-lint.log。
