# alpha.9 发布准备

2026-09-12，功能基线 512d5a8f10e970bef90c82195cca4b3d17c40948。本版通过新的 GitHub Actions 标签发布，不覆盖 alpha.8。

## 本版范围

本地终端 Shell/起始目录/中文本机标识；文件目录打开终端的路径字面值保护；双栏回收站入口与中文确认；sudo 密码标准输入、失败凭据恢复、超时及中止保护；删除批次部分失败与连接检查；回收站预写恢复意图和真实 SSH 中断后恢复。

正常旧回收站记录兼容，异常 pending 条目需新客户端恢复。Windows 本地 PowerShell/CMD 和多个文件/恢复场景已有专项实测；完整原始 R/F/B/A 清单仍继续，B16 已单项验证，不代表全产品完成。

## 发布前检查

版本仅修改 package 与 lock 根版本至 0.1.0-alpha.9，依赖未升级，后端版本元数据已同步。完整回归命令：
vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=../.cache/pre-alpha9-regression-results.json

日志 .cache/pre-alpha9-regression.log。全项目 lint 零错误、100 条既有警告；中文缺失键 0。真实 ConPTY 由 Actions 独立必过门禁，另要求原生模块、安装/在线升级/卸载和更新清单校验。

已核对远端没有 v0.1.0-alpha.9 标签。完整回归最终结果、标签推送、Actions 发布及公开附件校验仍待完成。README 下载链接保持已核验的 alpha.8，不能将准备记录当作 alpha.9 已发布。
首次完整回归不能用于发布：本地 Shell 新校验破坏了非 Windows 对 Windows 选项提示的既有原生 Shell 回退，已恢复该兼容行为，相关 7 项测试通过。同时 uploads.test.ts 工作进程出现 Node RemoveEnvironmentCleanupHook 的 env != nullptr 原生断言，11 项未完成；单独重跑该文件 12 项全部通过。首次日志/JSON 保存在 .cache/alpha9-first-regression-failure.*，未跳过该文件或改换测试池，完整回归正在重新执行。

最终完整重跑通过：553 文件通过、12 文件跳过；4020 项通过、23 项跳过，零失败、零 pending、零未处理错误，306.29 秒。上传测试在同样的两 worker 全量环境完成。首次原生断言原因尚未确认，单独和完整重跑均未复现，保留原记录继续由云端门禁检验。最终 tsc -b 通过；全项目 lint 零错误/100 既有警告，兼容修复文件 lint 通过。
