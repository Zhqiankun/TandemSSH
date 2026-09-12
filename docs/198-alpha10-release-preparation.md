# alpha.10 发布准备

2026-09-12，准备将 alpha.9 之后的修复交付到下一开发预览，继续由 GitHub Actions 构建和发布；本地不上传安装包。此次发布不代表完整产品验收完成。

## 发布范围

终端当前目录查询及真实 WebSocket 契约修复、文件与终端双向联动、下载定位错误提示、剪贴板回退清理；旧主机导入增加中文确认、默认停用激活状态、覆盖查询失败不降级新增；导入后的首页及时刷新。另补充保存流程参数原文执行与多类导入边界测试。

版本：0.1.0-alpha.10。公开标签不存在已核对，推送标签前仍须完成本地回归与真实 PTY 验证。

## 已完成预检

- npm run type-check：通过，后台元数据为 alpha.10。
- 全项目 ESLint：0 错误、100 条既有警告。
- check-localization.cjs：缺失中文键 0。

## 进行中

全量回归使用 2 workers，仅排除另行验证的 pty-integration.test.ts；日志 `.cache/pre-alpha10-regression.log`，JSON `.cache/pre-alpha10-regression-results.json`。本记录创建时回归未完成，不能据此声明通过或已发布。

后续必须核对完整回归结果、真实 PTY、Actions 发布门禁，以及公共安装包/latest.yml/校验文件。公共链接确认前 README 仍指向已验证的 alpha.9。

## 最终本地门禁

完整回归退出码 0：558 文件通过、13 文件跳过；4060 项通过、24 项跳过，0 失败，303.98 秒。机器可读报告 success=true。

独立真实 ConPTY 全文件退出码 0：11 项全部通过，86.17 秒；包含自动和协作 TaskRuntime、父 MCP 流程共用控制租约、参数原文以及人工接管阻止后续派发。报告 `.cache/pre-alpha10-pty-results.json`。

本地门禁通过后准备推送 v0.1.0-alpha.10，公开构建和发布必须继续等待 GitHub Actions；本记录不是发布成功证明。
