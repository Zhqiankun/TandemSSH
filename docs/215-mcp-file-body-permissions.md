# MCP 正文与编辑权限矩阵

## 修改边界

仅扩展 `app/src/backend/tests/files/production-file-tools.test.ts`。MCP 适配层继续调用 FileAutomation，任务归属和连接身份由 TaskRuntime 校验，文件版本及审阅由 AutomatedDocuments 管理。本轮没有新增共享抽象、生产接口或用户行为。

## 验收场景

自动、协作模式分别执行精确编辑和完整写入，共四个原生集成场景。原客户端经 Windows 系统凭据、签名本机管道及实际 stdio 子进程连接；文件数据经过同一已认证回环 SSH 连接上的真实 SFTP。读取 `/目录/配置%2F.txt` 获得真实正文版本后，增加四种身份：其他用户、其他配对、没有该主机权限、其他连接。

各身份调用 list_directory、stat_file、read_file、get_file_content、propose_file_edit、propose_file_write，共 96 次拒绝断言。其他连接返回 CLIENT_CONNECTION_CHANGED，另外三类返回 TASK_NOT_FOUND，均不包含 result。每次拒绝后任务、控制状态和终端写入记录不变；每组身份检查后，原文件实际字节及原客户端读取的正文仍相同。

原客户端随后继续原有编辑/写入流程。协作模式未经正文审阅的批准仍返回 FILE_REVIEW_REQUIRED，审阅后保存成功。自动模式按任务范围完成保存。输出文件仍为预期的中文 CRLF 内容；真实 SSH 连接数始终为 1。原客户端退出后任务取消、正文访问拒绝，已有保存结果保留。

## 实际验证

app 目录，明确设置 `TANDEM_TEST_REQUIRE_STDIO=1`、`TANDEM_TEST_MCP_ENTRY=E:\aiSSH\app\dist\backend\backend\mcp\stdio.js`：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/files/production-file-tools.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/files/production-file-tools.test.ts
```

1 文件、4 项测试通过，类型和 ESLint 通过。测试保留临时系统凭据删除、管道关闭、控制/文档存储关闭、SFTP 关闭的失败检查；没有写入日常 Codex 配置。

## 证据限制

越权身份通过另建的 SDK InMemoryTransport 注入核心，原客户端原生签名链路保持不变。因此本轮不能声称伪造身份通过了原生认证；它证明的是核心接收到不同可信身份后，不能借用原任务和文档版本。认证及撤销证据另见 208、209、211。

本轮未发现生产缺陷，也未发布安装包。文件正文六项工具的该权限矩阵已补齐；MCP 会话与恢复等其余验收仍需核对，整个产品保持未完成。
