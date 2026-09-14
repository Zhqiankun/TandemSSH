# C2S后端连接准入上限

2026-09-14，继续F12/B13资源占用边界。专用C2S WebSocket最多128条同时连接，底层30003服务TCP连接最多256条（含REST与握手连接）。达到WebSocket限值时，在认证/SSH工作之前返回C2S_CONNECTION_LIMIT并以1013关闭新连接，不关闭已有连接。

新增隧道内c2s-admission模块，拥有C2S准入常量和判断，server.clients由ws维护真实生命周期；index负责接入，权限检查仍归原认证/主机服务。没有通用共享抽象或反向依赖。底层TCP限值防止被拒绝连接在关闭握手期间无限累积，不宣称这是整个应用或所有服务的连接上限。

真实WebSocket测试用可注入的小限值2验证：第三条收到拒绝/1013，前两条继续回显；关闭一条后，新连接可准入并回显。默认128/256契约值另核对，不以小限值测试冒充128条压力测试。中文组件显示连接上限原因，无成功提示。

首次写入部分语言词条因缺少c2sErrors对象而中断，之后补齐所有语言容器并重新完成验证；未重复修改服务入口。准入与流控制初测4项通过，当前准入/中文组合计数见c2s-admission-ui-tests.log。日志位于.cache。

本轮尚未打包；每隧道远程子流数量、桌面本地监听数量及实际限额压力仍待检查，不把服务入口上限称作所有资源均已封顶。整体65/79，未推送Git或触发Actions。

最终准入/中文组合14项、tsc -b、修改文件ESLint与本地化检查通过；日志c2s-admission-final-types.log、c2s-admission-lint.log、c2s-admission-ui-lint.log、c2s-admission-final-localization.log。
