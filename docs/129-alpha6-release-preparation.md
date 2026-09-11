# alpha.6 发布准备与回归

2026-09-12。准备将 alpha.5 发布后已完成的修复交给 GitHub Actions 构建新的预览版，不替换既有版本附件。

用户可见变更：

- 文件管理：目录复制及无标准输出时的完成处理；重命名/移动目标冲突保护，Linux 跨文件系统移动后备；批量删除、sudo 重试和部分失败反馈；撤销使用实际成功目标，保留失败项，绑定原会话和目录类型。
- 编辑与传输：编辑器搜索/替换汉化、Ctrl+H；本机列表日期与语言一致，过滤期间禁用过期选择；上传下载部分失败行为和剩余时间显示。
- AI：任务问题草稿按任务/问题隔离，模型调用预算按钮显示实际增加值；BYOK HTTP 与自动/协作预算验收补充。

原始完整需求仍未全部验收。流程秘密执行传输尚待既有行为选择确认，当前只有未接入执行入口的系统凭据存储；不得在发布说明中声称秘密步骤已可用。目录撤销正常路径已在 Windows→真实 Linux SSH 验证，但部分失败/重连注入未在此次桌面场景验证。开源依赖声明与其他原始验收项继续保留。

回归基线 0df0bd0。完整应用回归使用 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；ConPTY 由 Actions 独立必过步骤验证。实际结果待进程结束后写入。全项目 lint 0 错误、100 项既有警告，汉化缺失键 0。

此文档目前是发布准备记录，不证明 alpha.6 已公开发布；README 下载链接在核实公开附件之前仍指向 alpha.5。

最终回归：542 文件通过、8 文件跳过；3,825 测试通过、19 跳过、零失败，297.29 秒。原始报告 .cache/pre-alpha6-regression-results.json，日志 .cache/pre-alpha6-regression.log。跳过项为真实 Vault 1、Linux 17、tmux 实际 shell 解析 1。本轮未启动这些外部环境；Linux 专项与 Windows 桌面实际文件操作另见文档 125、128，不将旧/专项证据冒充本轮全量执行。

版本已递增为 0.1.0-alpha.6，仅修改 package 与 lock 根版本，依赖未变。版本递增后 backend-version、sync-version、validate-release-ref、preview-updates、update-service、update-download 共 6 文件 / 30 项通过；后端版本元数据同步生成。公开远端无 v0.1.0-alpha.6 标签，准备使用新标签触发既有 Release Actions。云端发布尚待验证。
