# alpha.12 发布准备

2026-09-12。alpha.10、alpha.11 均在公开安装包发布前取消，旧标签保留；alpha.12 同时包含旧终端自动启动入口修复（199）和模型 Key 首次写入前加密修复（202），以及之前的文件联动、导入确认和停用默认值修复。

以 e1fa76d 为生产修复基线重新运行 type-check、全项目 ESLint、中文检查、两 worker 全量回归、独立真实 ConPTY。日志分别位于 `.cache/alpha12-typecheck.log`、`.cache/alpha12-lint.log`、`.cache/alpha12-localization.log`、`.cache/pre-alpha12-regression.log`、`.cache/pre-alpha12-pty.log`。创建本记录时尚未完成，不能提前称为通过。

发布仍只由 GitHub Actions 生成安装包、ZIP、blockmap、latest.yml 和 SHA256SUMS；云端还要执行原生模块及安装升级验证。公开后用实际下载校验所有文件，再由保留的旧客户端检测公共新版。不使用本地产物替代公开构建，不改写旧标签。

完整产品目标仍未完成，尤其 A16 的仅当前会话内存 Key 选项、剩余认证/设置/导入和许可清单；不因预览发布缩减原始验收范围。

## 最终本地门禁

type-check 通过，后台元数据为 alpha.12；全项目 ESLint 0 错误、100 既有警告；中文缺失键 0。

完整回归：560 文件通过、13 文件跳过，4124 项通过、24 项跳过、0 失败，322.31 秒。独立真实 ConPTY：11 项全部通过，88.55 秒，包含自动/协作、MCP 父流程共享控制权及人工接管。两个 JSON success=true，顺序检查脚本退出码 0。

本地门禁完成后推送 v0.1.0-alpha.12，继续等待 Actions 的原生模块、安装升级、清单与发布验证，不提前称为公开可下载。
