# 私钥解密校验前移到连接准备阶段

2026-09-13，A01/F02/B02，承接 294。

继续追踪实际失败入口发现 preparePrivateKeyForSSH2 原来仅检查 parseSSHKey 的格式识别结果。后者允许通过文件头识别已加密私钥，以便保存尚未填写口令的配置；因此口令错误时仍可能返回 Buffer，直到 ssh2.connect 同步解析才抛错。

连接准备函数现在按已安装 ssh2/lib/client.js 的规则再次 parseKey，取多密钥返回值中的第一项并确认 getPrivatePEM 非空。失败统一抛出固定“Invalid SSH private key or passphrase.”，不转发解析器异常内容。配置/导入阶段的 parseSSHKey 宽松识别保持不变。正确解密仍返回原格式 Buffer，不改写私钥。

新增错误/缺失口令准备失败与正确口令成功测试，协议测试将错误口令断言移到本地准备阶段，确认服务器成功签名次数不增加。与现有 PPK v2、密码/私钥/agent 协议、UI 分类联合 3 文件 30 项通过。

该函数被终端、文件、跳板、隧道、监控等多个连接入口使用，因此补跑 hosts 测试目录及 ssh-key-utils：85 文件通过、1 文件跳过；831 项通过、3 项跳过。跳过项不计为通过，不据此声称所有平台/外部环境均已验证。TypeScript、ESLint 通过。日志 .cache/private-key-preflight.log / private-key-consumers.log / private-key-preflight-tsc.log / private-key-preflight-lint.log。

无新模块、协议或依赖变化，仅在既有连接准备边界增加实际解密校验。尚未把294/295重新打包并执行桌面错误密码/错误口令矩阵，A01/F02/B02继续未完成，41/79不变。未提交、推送、打标签或触发Actions。
