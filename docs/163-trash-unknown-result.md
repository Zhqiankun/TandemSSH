# 回收站移动结果未知不再引导永久删除

2026-09-12。deleteItem 路由此前将所有回收站异常均标为 trashUnavailable=true，包括源文件已经尝试移动、后续记录或响应失败的情况。这会触发前端永久删除确认，不能准确反映原路径状态。

## 修改与边界

operation-routes.ts 负责本次请求阶段：getSessionSftp/listTrash 准备失败，仍按 409/trashUnavailable=true 保留原有明确确认后备流程；进入 moveToTrash 后抛错则返回 500/TRASH_RESULT_UNKNOWN/trashUnavailable=false，不把结果当作未执行。该分类保守：moveToTrash 内部在实际 rename 前失败也属于需核对结果，未新增自动重试或覆盖删除。

FileManager 显示新的中英文结果未知提示，要求刷新原目录与回收站。部分批次仍使用已有已确认/未确认计数。发现 deleteSSHItem 原 API 会丢失此结构化错误，改用既有 throwFileOperationError 并将 TRASH_RESULT_UNKNOWN 加入允许列表，只保留错误码和 HTTP 状态，不带入请求配置/认证头。

依赖方向仍为页面→文件 API→后端文件管理；没有新增模块或共享抽象，也未修改回收站移动/回滚实现及永久删除授权规则。

## 验证

后端两文件 24 项通过，新增覆盖准备失败、移动失败和移动已发生但响应丢失；后两者均不提供永久删除后备标记，也没有启动 Shell 删除。前端 API 7 项通过，实际调用 deleteSSHItem 确认错误码到达调用者且凭据不被保留。tsc -b 通过、中文缺失键 0、git diff --check 通过。ESLint 零错误，FileManager 的 windowId 与文件 API 的 buildFileManagerUrl 各有一条既有未使用警告。

这是路由、API 与回收站逻辑测试，本轮没有执行真实服务器删除或桌面端到端操作。完整 B09 仍未完成。

此修复发生在 alpha.8 标签固定之后，不包含于 880fcad 的 alpha.8 构建；已发布/已固定标签不改写。跟踪 alpha.8 Release 34661502595 时，实际 job 103464778590 已进入 Validate source，仍未公开发布。