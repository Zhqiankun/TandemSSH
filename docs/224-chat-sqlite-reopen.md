# 聊天记录实际 SQLite 重开验收

新增 `backend/tests/database/repositories/ai-chat-persistence.test.ts`，直接使用 better-sqlite3、Drizzle 和真实 AiRepository。测试创建工作区缓存下独立磁盘数据库，按项目 SQLite 迁移建表。测试辅助文件只导出现有 sqliteSchemaSql，未修改迁移生成或生产仓储。

## 验证

写入用户消息、含助手调用与工具结果的完整轮次、failed/interrupted 记录及旧版工具数组。将消息时间戳设为相同值后关闭数据库，再新建连接和仓储实例：

- 读回行与关闭前完全相同，按消息 ID 保持顺序。
- 中文正文、toolCallId/toolName、providerSignature 保持一致。
- 历史状态解析得到 failed/interrupted；模型回放排除这两类记录，完整记录和旧格式仍还原。
- 用户会话查询保持归属隔离；未授权用户 findConversation 返回 null。

另一个实际 SQLite BEFORE INSERT 触发器拒绝助手写入。仓储抛错，关闭重开后仅保留原用户消息，没有部分助手行。

相关数据库、HTTP、格式回归 **3 文件、9 项通过**；TypeScript、ESLint 通过。临时数据库在关闭后清理，清理前验证实际绝对路径属于本轮创建的工作区缓存目录。

## 证据范围

本轮是实际磁盘 SQLite 持久化与关闭重开，没有模拟数据库。它不等同于桌面默认“内存 SQLite + 整库加密文件”的保存/重启链路，也不证明断电后的 fsync 持久性。桌面整库加密已有独立证据（205），聊天实际打包界面重启仍须继续验证。

listMessages 本身只接收会话 ID，身份归属由调用它之前的 HTTP findConversation 门禁负责；本测试不将该接口误述为自行鉴权。没有生产功能变化，没有发布新安装包。
