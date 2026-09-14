# 基础认证与导入原始验收 A36

2026-09-14，按06-delivery原始A36“私钥口令/agent/交互认证/单跳可用，导入不执行隐藏命令”逐项复核。本轮不修改生产代码。

| 原始要求 | 直接证据与当前核查 |
| --- | --- |
| 私钥口令 | 296真实桌面正确加密口令完成RSA认证，错误口令认证前拒绝且无自动重试；285真实Linux连接；本轮SSH认证协议回归 |
| Agent | 53真实Windows命名管道、仅选定公钥、信任前零查询/签名、终端/SFTP/监控成功；297补齐sign身份检查；本轮Agent协议与适配器回归 |
| 交互认证 | 60—64终端/文件/监控/跳板队列，原始多轮、空回复、保留空白、取消和旧ID拒绝；本轮四份交互协议/服务/HTTP回归 |
| 单跳 | 64真实Windows→交互跳板→认证入口→Alpine OpenSSH PTY，双方指纹分别核对，限定目标转发，MCP automatic/collaborative执行及人工接管后禁止后续写入；本轮jump-interactive回归 |
| 导入不执行隐藏命令 | 199真实桌面字节捕获确认启动片段/环境变量/Mosh自动输入关闭；当前代码只记录中文说明；392原始A22统一回归82项及真实导入确认/停用证据 |
| 重连与旧权限补充 | 300真实双模式断线重连后human，旧会话授权/旧批准拒绝，独立SFTP确认禁止文件不存在；本轮交互认证撤权/取消和跨用户HTTP边界回归 |

## 当前验证

SSH认证协议、terminal-agent-auth、keyboard-interactive及protocol、shared-interactive服务与HTTP、jump-interactive、host-trust-ssh，共8文件49项通过，无跳过。日志.cache/basic-auth-original-scope.log。未改源码，不将旧类型/构建检查冒充本轮新测。

已复读原始报告：
- 9d556888-0478-43d9-b99f-5100fbe0a297/auth-matrix-result.json：四种正确/错误密码/口令结果。
- 3d23095b-b36a-4967-8670-53130cfa80c0/agent-auth-result.json：真实命名管道、3次选定身份签名、终端/SFTP/监控。
- 92ece3ff-4ad2-4582-a918-c5f2d1e68fe3/keyboard-auth-result.json：双模式、单跳、多轮、取消与旧回复拒绝。
- 8970dbba-1170-4565-926c-03081f08b593/reconnect-result.json：新连接、人工控制、旧权限拒绝、无后续文件副作用。
这些位于.cache/desktop-observation-report-<ID>/；对应源记录保留环境和清理细节。

A36是基础认证与导入组合，不要求证明所有第三方Agent、所有SSH服务器认证插件或隧道认证全排列。相关隧道/设置/终端原始条目仍独立保留；不因A36通过宣布完整基础SSH产品完成。

原范围具备当前代码回归和直接运行证据，标记A36 verified，整体62/79，剩余17条。未推送Git或触发Actions，公开安装包不变。
