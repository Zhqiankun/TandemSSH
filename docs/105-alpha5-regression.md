# alpha.5 发布前回归

2026-09-12，源码 e3590a3 完整应用回归：525 文件通过、6 文件跳过；3,730 测试通过、16 跳过、零失败，285.57 秒。报告 .cache/pre-alpha5-regression-results.json，日志 .cache/pre-alpha5-regression.log。

跳过范围为真实 Vault 1 项、真实 Linux 14 项和 tmux 实际 shell 解析 1 项。真实 Linux 人工交还与回收站等另有此前专项报告；本轮未启动 VM，不将专项旧结果称为本轮全量执行。ConPTY 未在此运行，与既有设置一致，交由 Actions 独立门禁验证。

全项目 lint 零错误、100 条既有警告；中文缺失键 0。版本递增到 alpha.5 后更新发布预检 5 文件 / 23 项通过；随后按真实文件名另行复核 backend-version 与 sync-version。依赖版本未变，仅应用及 lock 根版本递增。

本次计划通过推送 v0.1.0-alpha.5 触发 Release Actions。发布前合入已批准的 alpha.4 下载说明；README 仍指向已存在的 alpha.4，待新发布附件验证后再更新。没有本地上传发布包、没有覆盖已发布标签或附件，仍保留预览渠道。

实际云端构建和公开附件需在 Actions 完成后核对；当前记录仅证明发布前本地检查。完整产品验收与原始需求范围不变。
构建版本补充复核：backend-version / sync-version 两文件 9 项通过。
