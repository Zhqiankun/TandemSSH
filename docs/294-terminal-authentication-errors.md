# 终端认证失败的结构化分类与停止重连

2026-09-13，A01 / F02 / B02 局部修复。

私钥解析失败原来只发送英文异常文本，客户端依赖字符串判断是否属于认证失败。部分 encrypted private key / passphrase 消息不能稳定命中，且网络错误判断先于认证判断。

现在终端私钥准备失败发送 SSH_PRIVATE_KEY_INVALID 及固定安全消息；该捕获点不再把解析异常正文拼接到日志或 WebSocket。UI terminal-authentication-failure.ts 负责错误帧的纯分类，识别稳定错误码及兼容旧版认证/私钥消息；Terminal 在网络重连启发式之前处理认证失败，显示中文提示、清除连接计时器、停止自动重连并关闭当前 WebSocket。手动重试入口保持既有行为。

新分类模块归属终端功能，仅负责消息语义，不接触凭据、连接、日志或状态存储；它的独立测试覆盖结构化代码优先、加密私钥缺口令、解析失败、密码/认证失败、带 connection 字样的认证失败与普通网络超时区分。移除 Terminal 中重复的旧分类分支。

3 文件 13 项通过：分类测试、重试钩子的失败停重试/手动重试行为、真实 ssh2 密码与带口令私钥以及 agent 协议测试。TypeScript、ESLint、汉化检查通过（缺失键 0）。日志 .cache/terminal-auth-failure-final.log / terminal-auth-failure-tsc.log / terminal-auth-failure-lint.log / terminal-auth-failure-locales.log。

范围限制：协议测试使用真实回环 SSH 和测试 agent；重试钩子测试不等于实际 Terminal 组件的 WebSocket 端到端验收。本轮源代码接线已检查，但尚未打包并实测错误密码/错误私钥口令下的桌面重连行为。A01/F02/B02 保持未完成，41/79 计数不变。未提交、推送、打标签或触发 Actions。
