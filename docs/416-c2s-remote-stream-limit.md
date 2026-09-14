# 远程C2S子连接上限与重复ID

2026-09-14，继续资源边界。每条remote中继最多32个活跃SSH子流，达到上限在accept之前拒绝新的远端连接。Electron也在创建本地TCP socket之前检查32条上限，超额发送该streamId的close通知，不中止已有通道。

客户端重复connection消息中的streamId现在忽略，不再新建socket覆盖Map内旧socket。新增electron/c2s-remote-streams.cjs只负责此远程子流准入判断；后端限值由c2s-admission提供，两端通过契约测试核对32。没有后端依赖Electron或通用共享模块。

真实远程监听/SSH测试实际建立32条TCP子连接，第33条被拒绝且没有新增connection通知；已有流仍传递独立数据。关闭一条后，新连接被接收，总历史connection事件为33、活跃数仍受限；清理后SSH客户数0。客户端Map用例验证重复ID保持原对象、释放后允许准入。

首轮失败是WebSocket事件夹具缺少bufferedAmount和close：数据工具将undefined缓冲量误判为高水位，清理调用也失败。补齐真实接口语义后重跑，未改变产品逻辑或放宽32条/数据可用/复用断言。初次日志.cache/c2s-remote-limit-tests.log保留。

最终隧道/客户端准入共2文件64项通过，日志c2s-remote-limit-final.log。SSH/TCP为真实协议，WebSocket侧为完整事件夹具，不冒充原生桌面32条压力验证。本轮尚未打包，桌面监听数量仍待补齐。整体65/79，未推送Git或触发Actions。

最终tsc -b、修改文件ESLint与main.cjs语法检查通过，日志c2s-remote-limit-final-types.log、c2s-remote-limit-lint.log。
