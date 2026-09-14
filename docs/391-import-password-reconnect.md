# 覆盖导入更新密码后的真实重连

2026-09-14，在390的真实Windows＋本机SSH/SOCKS流程上扩展密码生命周期，本轮没有修改生产代码或重新打包。

初次SSH认证使用测试旧密码，经SOCKS建立连接并读回首个终端标记。保持连接期间通过实际bulk-import overwrite将保存密码更新为新的测试密码，同时关闭代理；请求updated=1。随后SSH测试服务切换为只接受新密码。原已认证通道仍收到第二个标记，证明数据库密码更新不会中途重做旧连接的认证。

测试服务断开当前通道，用户通过中文按钮手工重连。新连接使用新密码成功认证，服务端在轮换后记录的旧密码尝试次数为0；重连后的独立终端标记被读回。390的代理计数与旧代理参数注入断言也再次通过。

只记录认证成功与旧密码重试次数，不把测试密码写入报告。原始报告.cache/desktop-observation-report-659dd56f-ff59-4ef7-9ec9-a74c66776118/credential-lifecycle-result.json已读取，全断言通过。脚本credential-lifecycle-observer.cjs、run-credential-lifecycle.cjs；日志credential-lifecycle-native.log。客户端cleanExit=true、脚本exit0，浏览器send方法恢复，客户端与本轮SSH/SOCKS监听关闭。

范围为密码认证的人工终端生命周期；不替代私钥/凭据库引用/代理认证轮换矩阵，也不证明旧AI/MCP授权会因任意配置变更立即撤销。已建立通道继续使用其原本认证结果，新连接重新解析保存的凭据。A22仍需自动任务、其他运行资源以及完整预览覆盖差异验收，整体60/79。

未推送Git、未触发Actions，公开安装包不变。
