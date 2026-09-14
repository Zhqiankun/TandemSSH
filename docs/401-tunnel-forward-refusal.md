# C2S转发拒绝后的资源释放

2026-09-14，补充F12/B13/A35。本轮只修改测试，生产实现保持不变。

核对connectClient：握手ready后仍保留AbortSignal监听，直到SSH close才解除；中继打开失败会中止所属lifetime，因此转发失败也能关闭已认证连接。

新增local/dynamic/remote三个实际SSH服务拒绝场景。服务端只接受固定测试转发范围，本轮请求明确不在允许集合内的端口。完成主机信任确认后，服务端收到一次拒绝请求，统计forwards=0、binds=0、execs=0、denied=1。等待后真实SSH客户端连接数0，信任提示列表为空，WebSocket发送记录没有ready。

这证明既有取消机制覆盖了认证完成后的转发/远程监听拒绝，而不是将泛化异常当作已正确清理。SSH为真实回环协议；WebSocket接口用事件夹具，不能称作本轮真实桌面测试。正常监听和Echo端点由原夹具统一清理。

隧道与代理取消共2文件69项通过，日志.cache/tunnel-forward-denied-tests.log。没有新生产模块、共享抽象或依赖变化。398/399生产变更尚待打包验证，持续运行后撤权及主进程极早取消继续独立跟踪。整体64/79，未推送Git或触发Actions。

最终tsc -b及修改文件ESLint通过，命令链exit0；日志tunnel-forward-denied-types.log、tunnel-forward-denied-lint.log。
