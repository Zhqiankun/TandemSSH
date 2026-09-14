# SSH 保活与静默网络的真实协议验证

2026-09-13，F02/B02，承接 298。

新 ssh-keepalive-protocol.test.ts 使用当前 resolveSshKeepalive、真实 ssh2 客户端/服务器与临时回环 TCP 代理，固定测试密码与独立 RSA 主机密钥。没有模拟计时器或伪造 SSH ready 事件。

- interval=5 秒、countMax=1：空闲已认证连接收到至少两次真实 GLOBAL_REQUEST keepalive@openssh.com；首个和相邻报文间隔不早于 4 秒，客户端未报错或断开。服务器协议回复使连接保持有效。
- interval=0：观察 6 秒，服务器收到保活报文数为 0，连接仍在。
- 静默网络：认证完成后代理丢弃双向数据，保持 TCP 端点存在；客户端按 5 秒/1 次配置触发 Keepalive timeout 并关闭连接，耗时至少 9 秒，服务器未收到被丢弃的保活。不是通过直接销毁客户端伪造断线检测。

报文观测使用已安装 ssh2 协议解析器的 Inbound: GLOBAL_REQUEST 调试事件，仅记录到达时间。主机指纹由客户端固定核验本测试公钥；此项不替代 UI 的信任确认验收。所有测试客户端、服务器、代理及 Socket 在 afterEach 关闭。

与参数边界测试合计 2 文件 16 项通过，耗时约 26.7 秒；TypeScript、ESLint、diff 检查通过。日志 .cache/keepalive-protocol.log / keepalive-protocol-tsc.log / keepalive-protocol-lint.log。

本轮只新增验证，没有生产代码变更。尚未验证断线后的实际桌面重连和旧任务授权失效，F02/B02继续未完成，42/79不变。未提交、推送、打标签或触发 Actions。
