# 保存主机关闭代理后的真实直连验证

2026-09-14，将388修复构建到本地Windows目录包。

独立客户端创建保存主机useSocks5=false，目标是本轮ssh2真实协议服务；另开独立本机TCP监听端口代表旧代理，统计访问次数。只对本轮主机ID的浏览器connectToHost消息注入旧客户端代理字段：useSocks5=true、旧地址/端口和测试认证信息。通过中文主机指纹确认建立终端，使用真实键盘输入PROXY_DIRECT_MARKER，SSH服务从加密通道读到该标记。

断言注入消息数至少1、SSH会话已建立、终端标记到达、旧代理连接数为0。结束前恢复WebSocket.send原方法，正常退出客户端并关闭本轮SSH/TCP服务器。该故障模拟不改生产代码，不触及真实用户凭据或外部主机。

原始报告.cache/desktop-observation-report-d5e80160-9012-4cf7-bbb0-b505ade2e4c0/saved-proxy-result.json已读取，所有断言通过。脚本saved-proxy-observer.cjs、run-saved-proxy.cjs；日志saved-proxy-native.log。客户端cleanExit=true、脚本exit0，业务端口释放。

源码build和electron-builder目录包成功，日志saved-proxy-build.log、saved-proxy-package.log。本地包已包含388代理合并修复，公开安装包未更新。未推送Git或触发Actions。

范围：本轮证明携带旧代理配置的新连接遵循服务端关闭设置，不是完整的“原代理连接运行中→修改设置→断开重连”生命周期，也不证明自动任务在认证变化时全部撤销。A22保持未完全验收，整体60/79。
