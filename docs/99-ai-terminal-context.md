# AI 交还后的终端上下文

2026-09-12，补齐 98 中确认的人工输出未进入模型请求问题。

## 契约与实现

会话管理器继续拥有原有有界终端输出缓冲。TaskSession 增加同步 readOutput 适配端口，生产实现复用 sessionManager.getOutputSnapshot；未增加 SSH 连接或重复缓冲。

TaskRuntime.modelTerminalContext 仅接受所属 agent 任务，重新核对用户及会话、ready 状态和当前租约；读取前后核对控制权，输出 generation 必须一致。完整缓冲先走现有 redact，再截取尾部最多 12,000 字符，附 sessionId、generation、cursor、truncated 和非可信标记。不会开放给人工或 MCP 作为绕过既有读取权限的新入口。

AI 编排器在每次已授权执行请求前获取快照，作为单独 user 消息附带中文非可信数据说明。规划阶段不读取。上下文不加入持久聊天历史，避免每轮重复累积；没有输出适配器的测试/兼容会话保持既有行为。生产始终提供适配器。快照读取位于模型请求 try/finally 内，失败也清理请求状态。

依赖方向保持 AI → 任务公开接口 → 会话端口；生产组装层连接具体会话管理器。未新增通用共享模块、数据库字段或迁移。

## 验证与边界

- 快速接管并交还时，模型收到人工操作标记、新 cwd 和人工介入提示；迟到旧命令未执行。
- 输入超过 13,000 字符并在截取范围内放置秘密字段，模型文本最多 12,000 字符、truncated=true，已知秘密不存在。
- 未授权、已接管、跨用户、跨 agent 任务均拒绝读取；正确授权任务可读。
- AI runner / task-runtime 共 46 项通过，结果 .cache/model-terminal-context-results.json；修改文件 ESLint 通过。

本轮是可控模型与写入夹具验证，尚需实际 Windows/SSH 的人工操作后交还观察。脱敏遵守既有已知模式，不能保证识别任意未知秘密。这里只提供最近输出且明确标记截断，不声称完整终端历史或能够消除提示注入。公开 alpha.4 不包含本次改动。
`npm run type-check` 本轮亦已完成并通过。
