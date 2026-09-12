# MCP 恢复工具权限与重连

## 责任与范围

扩展 `app/src/backend/tests/collaboration/recovery/execution.test.ts`，不修改生产行为或新增共享抽象。SDK 工具经 McpCore 调用 TaskRecoveryService；服务验证原用户、配对和主机权限，TaskRecoveryStore 管理加密检查点、领取与消费状态，TaskRuntime 创建等待新授权的任务。

## 实际检查

自动、协作模式分别通过 save_task_progress 保存实际 MCP 任务。其他用户、其他配对、未授权主机的 list_saved_tasks 返回空数组；get_saved_task、restore_task_progress 返回 TASK_RECOVERY_NOT_FOUND，save_task_progress 返回 TASK_NOT_FOUND。合计 6 次空目录断言、18 次错误断言；每次错误后实际存储记录与原任务保持一致，没有终端写入。

新建运行时和存储实例，使用原配对的新 connectionId 读取并恢复检查点。恢复生成新任务 ID，保留原模式，状态为 awaiting-authorization，控制权仍为 human，写入数组为空；旧记录变为 consumed，再次恢复失败且只有一个新任务。

## 验证

app 目录：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/collaboration/recovery/execution.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/tests/collaboration/recovery/execution.test.ts
```

完整恢复文件 15 项测试通过；类型和 ESLint 通过。既有未知结果人工核对、父流程续接和持久化领取门禁测试一并执行。

## 限制

新增矩阵使用实际磁盘加密检查点存储及随机测试密钥，SDK InMemoryTransport 注入身份，命令端记录写入；不等同于系统凭据或真实远端 SSH 验收。新存储/运行时实例用于验证重连契约，本轮未进行桌面进程重启。临时目录仅在验证绝对路径属于自建缓存目录后清理。

四项恢复工具的本次权限矩阵完成，不据此宣称全部 MCP 或产品交付。会话工具权限证据仍需核对；未发布新安装包。
