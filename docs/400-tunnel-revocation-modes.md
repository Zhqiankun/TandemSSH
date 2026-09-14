# 三种C2S模式握手后撤权矩阵

2026-09-14，扩展399，不修改生产代码。

将真实SSH握手后撤权测试从测试入口扩展到test/local/dynamic/remote四条入口。服务端真实ready之后，权限夹具返回无访问权；随后调用被Access denied拒绝。每例实际完成认证1次，SSH服务转发计数0，最终客户端连接数0。

额外以不替换实现的spy观察Client.forwardOut和forwardIn，二者均0调用。这补齐remote路径没有发送远程监听请求的证据，不能只以本地tcpip数据转发计数为0推断远程监听未建立。

隧道信任/生命周期与代理取消共2文件66项通过，日志.cache/tunnel-access-modes.log。沿用当前公开处理函数及真实回环SSH，WebSocket对象为事件夹具；不宣称本轮进行了原生桌面或完整持续传输撤权测试。

原有模块责任和依赖方向不变。398/399生产修改仍待合并打包验证，监听前极早取消与持续运行资源撤权仍按原条目保留。整体64/79，未推送Git或触发Actions。

最终tsc -b及修改文件ESLint通过，命令链exit0；日志tunnel-access-modes-types.log、tunnel-access-modes-lint.log。
