# 指定 agent 身份的签名入口检查

2026-09-13，F02/B02 局部加固。

FilteredAgent 原来在 getIdentities 过滤指定公钥，但 sign 直接转发任意调用参数。现 sign 也使用同一身份匹配规则，未选中身份通过回调返回固定 SSH_AGENT_IDENTITY_MISMATCH，不调用底层签名。三参数和四参数重载均覆盖。

同时将 OpenSSH 公钥文本按实际公钥结构解析比较，避免新签名检查拒绝接口本来支持的字符串形式；ParsedKey 和原始 SSH 公钥 Buffer 保持支持。只修改既有认证适配器，不增加公共工具或访问系统 agent。

新增断言修复前 2 项失败。修复后 2 文件 19 项通过，包含指定身份/不存在身份、两种签名调用形式、选中公钥的三种表示，以及实际临时命名管道 agent→回环 SSH 签名认证。TypeScript、ESLint、diff 检查通过。日志 .cache/agent-sign-before.log / agent-sign-after.log / agent-sign-tsc.log / agent-sign-lint.log。

边界：本轮限制的是认证适配器的身份列举与直接 sign 调用。getStream 的既有 agent 转发行为未变，不能将本修复描述为对转发 agent 的全部能力实施了同样限制。当前目录包尚未包含本轮改动，完整 agent/交互/跳板/重连验收继续，42/79 计数不变。未提交、推送、打标签或触发 Actions。
