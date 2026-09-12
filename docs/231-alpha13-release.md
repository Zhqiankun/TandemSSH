# alpha.13 发布记录

## 候选版本与门禁

版本 0.1.0-alpha.13，源码在 codex/unix-permissions；main 不在本次修改范围。公开安装包仅由版本标签触发的 GitHub Release Actions 构建、生成清单并上传。

本地发布前验证已完成：

- 强制 TypeScript 检查、完整 ESLint 和字面翻译键检查通过。
- 源码回归 573 文件通过、13 文件按条件跳过；4236 项通过、24 项跳过，耗时 316.99 秒。报告 `.cache/alpha13-source-results.json`。
- 独立真实 PTY 11 项全部通过，耗时 86 秒。覆盖自动/协作、同 Shell 状态、参数原文、父任务流程和人工接管后停止后续步骤。报告 `.cache/alpha13-pty-results.json`。

本版变化见 75-preview-release-notes.md。MCP 验收收尾见 208–219，聊天历史及失败/中断记录、重启、分页、并发见 220–230。

## 发布状态

已推送 v0.1.0-alpha.13（d9994dfab60217b990605e973f7d8f45f845cfcc），Release 运行 34693721741、job 103553456812 已确认运行。云端构建、Windows 安装/升级/卸载门禁、公开资产和旧客户端发现验证尚未完成；在实际成功前不把本版写成已可下载。

待核对五份资产：EXE、EXE.blockmap、ZIP、latest.yml、SHA256SUMS.txt。保留内部更新按钮、启动检查和每 20 分钟自动检测；下载与安装仍由用户点击。

本版是开发预览，不代表全部 R/F/B/A 项完成。流程秘密参数、部分认证/监控/导入及资源限制等独立剩余项继续保留。

前一 CI 暴露干净检出 .cache 未初始化的问题，复现与测试准备修复见 232；该修复在标签后，不修改 alpha.13 标签。
