# S2S每隧道数据连接上限

2026-09-14，补齐独立C2S之外的S2S子连接资源保护。

manager内定义S2S_STREAM_LIMIT=32。单主机local/dynamic监听使用net.Server.maxConnections；单主机remote在accept前检查本地连接集合；双主机模式在accept前检查独立inboundStreams集合，close时删除，整体停止时销毁并清空。动态模式在SOCKS解析前也计入名额，不能靠不发送握手逃避限制。

四组真实SSH/TCP容量测试：single-host/two-host × local/remote各建立32条可回显数据连接，第33条被关闭；第一条继续回显，证明拒绝未中断既有通道。停止后全部客户端关闭、runtime移除、原端口能重新绑定。动态模式沿用相同监听/集合限制并有既有正常SOCKS数据回归，本轮未单独做32条动态握手容量场景。

隧道全文件67项通过，日志.cache/s2s-capacity-tests.log。模块责任仍在S2S manager，不增加共享抽象或跨层调用。本轮源码尚未打包；整个S2S活动隧道数量准入仍需核查，不能将每隧道连接上限称为全进程资源上限。

整体65/79，未推送Git或触发Actions。

最终tsc -b及两处修改文件ESLint通过，命令链exit0；日志s2s-capacity-types.log、s2s-capacity-lint.log。
