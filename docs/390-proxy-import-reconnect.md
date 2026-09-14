# 覆盖导入关闭代理后的完整重连

2026-09-14，接续388/389，本轮没有修改生产代码。

独立Windows客户端与本机真实SSH、SOCKS5服务建立代理连接。SOCKS夹具仅接受本轮127.0.0.1 SSH端口，不具备任意转发能力。首次终端标记由SSH服务读回，SOCKS成功转发次数至少1，确认初次连接实际走代理。

连接保持期间通过实际bulk-import overwrite请求关闭保存主机的代理设置，updated=1；查询保存结果useSocks5=false。原终端再次输入独立标记成功，代理连接数量不增加，表明修改保存配置没有将已经建立的SSH流中途重新路由。

随后由本轮SSH服务断开当前连接，点击真实客户端中文重连按钮。对本轮主机的connectToHost消息仍注入旧代理参数，以复现旧页面持有配置。新连接建立后第三个独立终端标记抵达SSH服务，SOCKS成功连接计数保持初始值，没有新增代理访问；注入至少发生两次，覆盖初连和重连。

原始报告.cache/desktop-observation-report-ee1da787-662b-4030-9ec5-3999e852415e/proxy-lifecycle-result.json已读取，全断言通过。脚本proxy-lifecycle-observer.cjs、run-proxy-lifecycle.cjs；日志proxy-lifecycle-native.log。客户端cleanExit=true、脚本exit0，调试send方法恢复，客户端业务端口和本轮SSH/SOCKS服务关闭。

这是实际Windows UI＋本机SSH/SOCKS协议流，没有Linux Shell命令执行模拟；终端标记由服务端通道接收。该流程证明人工已建连接及后续重连行为，不证明连接配置变化期间旧AI/MCP任务授权已全部撤销，相关范围继续保留。

沿用389已构建的本地包，未重复构建。A22仍需完整覆盖差异、预览绑定及其他运行资源验收，总体60/79。未推送Git或触发Actions。
