# 历史缓冲绑定后端会话

2026-09-14，继续439输入接受确认后的生命周期核对。

原useCommandTracker只按hostId/enabled变化重置；同一主机建立新SSH会话时这两个值不变，未提交的旧行或转义序列可能残留。新增bindSession(sessionId)，仅在后端会话ID变化时同步清空缓冲和转义状态。同一会话再次附着不清空，避免破坏仍存活Shell中的未提交输入。

Terminal.tsx在sessionCreated与明确sessionAttached事件中，分别绑定即时本地行跟踪器和已接受输入历史跟踪器。既有输入确认仍匹配sessionIdRef，未加入自动重放。没有新增共享模块、API或数据库迁移；职责留在终端业务Hook和会话事件编排。

12项相关测试通过，覆盖新会话重置、同会话保留，以及Unicode/退格/启停/输入接受确认既有回归。日志.cache/history-session-tests.log。此处为Hook生命周期及输入确认测试，尚未增加真实Windows“输入半行→断线→新会话”的重连矩阵，不能作为完整F03连接状态实机验收。

整体67/79，原始剩余范围保持。未重打包本轮改动、未推送Git、未触发Actions，公开安装包未更新。
最终 `tsc -b` 与修改文件 ESLint 均 exit0；日志 `.cache/history-session-types.log`、`history-session-lint.log`。
