# 基础协作要求证据归并与 alpha.5 MCP 复核

2026-09-12，按 R03/R04 原文核对已有证据，不以总测试数代替要求。

| 要求 | 对应证据与结论 |
| --- | --- |
| R03 人和 AI 操作同一 SSH 会话，输出和上下文可衔接 | 56 的真实 Windows/MCP/Alpine 结果证明同一 Shell 的环境与 cwd 衔接、实际标记及人工输入；102 的两模式 Windows AI 交还证明人工输出经过生产缓冲进入下一次模型请求并完成新操作；107 证明另一标签输入不混入原任务。原始三个 JSON 本轮重新读取，R03 可标记 verified。 |
| R04 接管确认后旧 AI 写入不得进入会话，交还必须明确操作 | 当前 SessionControl 同步递增 epoch / 撤销旧租约，commitWrite 每次断言，humanInput 先接管后写入；91 的准备/审计等待与迟到模型竞态、98 的旧批准失效、102 的真实界面接管/明确交还、97 的 MCP 接管后新请求拒绝共同覆盖该要求。R04 可标记 verified。 |

R04 不表示已经发送到远端的命令能够回滚；A05 的结果状态验收仍按自己的范围保留。R03 不表示任意模型都能正确推理；真实模型 HTTP 响应是本机确定性夹具。R01/R05/R06 与认证、文件、许可等其余要求不随本表一并完成。

## 当前 alpha.5 开发包的实际 Codex 接入

使用已安装 Codex CLI 7ac07f4ce733f89a 与本地 alpha.5 目录包，MCP stdio / transfer-stdio 2 文件 3 项通过：授权前拒绝、授权后受限命令、断开失权和自动/协作文件传输。临时配对由测试创建并清理，不改日常配置，不调用付费模型。

.cache/codex-mcp-integration.json 显示 configurationValidated=true、serverInfo.version=0.1.0-alpha.5、toolCount=38。结果 .cache/alpha5-codex-mcp-results.json，日志 .cache/alpha5-codex-mcp.log。这是本地验证包证据，不冒充尚待确认的公开安装包。
