# alpha.11 发布准备

2026-09-12。alpha.10 因发现旧终端启动原始输入绕过受控流程而取消（见 199），标签不重写。alpha.11 在 00a3c25 基线移除该路径，普通人工输入保持可用。旧本地客户端复现和修复后真实 Windows/SSH 对照均已记录。

重新执行完整门禁：type-check → 全项目 ESLint → 中文键检查 → 两 worker 全量回归 → 独立真实 ConPTY 全文件。门禁尚在运行时不得推送版本标签或声称公开可下载。

日志位于 `.cache/alpha11-typecheck.log`、`.cache/alpha11-lint.log`、`.cache/alpha11-localization.log`、`.cache/pre-alpha11-regression.log`、`.cache/pre-alpha11-pty.log`；回归与 PTY 另生成对应 JSON。

发布只通过 GitHub Actions；云端继续验证安装、升级、原生模块和更新清单。公开后实际下载校验 latest.yml、SHA256SUMS、EXE、blockmap、ZIP，并用旧客户端检查真实公共新版。公共链接验证前 README 保留上一已验证版本，不宣称新版本已经发布。

## 全量回归结果

本轮强制类型检查通过，后台元数据为 alpha.11；全项目 ESLint 0 错误、100 既有警告，中文缺失键 0。

全量回归：558 文件通过、13 文件跳过；4060 项通过、24 项跳过，0 失败，304.43 秒。独立真实 PTY 在全量回归成功后顺序启动，尚待最终结果。

## 最终门禁

独立真实 ConPTY 全文件 11 项全部通过，85.73 秒；包含自动/协作任务、MCP 父流程共享租约与 Shell、参数原文、人工接管取消后续派发。顺序门禁脚本最终退出码 0。

所有本地门禁通过后推送 v0.1.0-alpha.11；公开产物仍需等待 Actions 安装、升级、清单与发布验证，不因本地通过提前标记公开发布。

## 发布取消

后续 A16 审查发现模型 Key 首次明文插入和加密不可用时明文回退（见 202）。Release 34679768304 在安装升级验证阶段取消，最终 completed/cancelled，未公开发布。标签保留，修复版改用 alpha.12 并须重跑门禁。
