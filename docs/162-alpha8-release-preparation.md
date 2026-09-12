# alpha.8 发布准备

2026-09-12，功能基线 5567926fcb410b512fbae3cef15c9053fa4a2311。目标是通过 GitHub Actions 提供包含 alpha.7 后续修复的 Windows 开发预览，不覆盖既有版本。

本版包含：MCP 并发重试共享原操作、远端文件复制防覆盖/防目录合并、普通及永久删除批次会话切换停止、已知交互程序的审查与严格模式规则、历史日期跟随软件语言，以及 AI/MCP/流程重试和恢复的验收补充。发布说明原先仍写 alpha.5，本次改为 alpha.8 实际变更。

版本仅递增 package.json 和 lock 根版本，无依赖升级。后端版本元数据已同步。完整应用回归运行命令：
vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=../.cache/pre-alpha8-regression-results.json

日志位于 .cache/pre-alpha8-regression.log。真实 ConPTY 交由 Actions 单独必过门禁；Release 还要求原生模块、安装/在线升级/卸载验证和 latest.yml/校验文件生成。全项目 lint 零错误、100 条既有警告；中文缺失键 0。

创建标签前已核对远端不存在 v0.1.0-alpha.8。完整回归、标签推送、Actions 发布和公开附件下载核验尚未完成；本记录不证明 alpha.8 已发布。公开 README 下载链接暂时保留已验证的 alpha.7。

完整目标保持：自动与协作模式、人工随时接管、MCP、文件/流程/规则/审计等全部原始验收。秘密步骤传输选择、未完成桌面文件矩阵及第三方声明清单仍未完成，不因预览发布而缩小范围。
完整应用回归已完成：548 文件通过、10 文件跳过；3937 项测试通过、21 项跳过、零失败，302.61 秒。机器报告 success=true。未运行专项环境的跳过不计为已验证，真实 ConPTY 仍为 Actions 独立门禁。
