# A11 保存流程参数原文执行验收

2026-09-12，原始标准 docs/06-delivery.md：参数包含引号、换行、替换语法时，保持单个参数或明确拒绝，不生成额外命令。

## 验证链与结果

增强已有真实 PTY 用例：WorkflowDefinition → compileWorkflow → CommandAction → PtyCommandExecutor → SessionControl.commitWrite → Windows ConPTY / Git Bash 实际 Shell → 输出帧解析。生产代码与依赖未改动；只将原来手工构造 argv 的测试改成从保存流程编译入口生成命令，并覆盖 command、script 两种步骤。

参数同时包含中文、单引号、双引号、反斜杠、制表符、多行、两个尾部换行、`$(touch ...)` 和反引号命令替换；目标为测试夹具独有目录中的副作用标记。实际 Shell 返回参数个数 1，参数字节转 base64 后与输入逐字节一致，副作用标记文件不存在。执行 cwd 为带中文及单引号的子目录，返回 cwd 与目标一致。

- 真实 PTY：2 项通过，14.68 秒；按名称筛选，本文件其余 9 项未执行，不能据此声称整个文件本次全通过。
- workflow-definition.test.ts：10 项通过，包括参数类型、未知参数、布尔映射、默认值及不支持秘密传输的明确拒绝。
- 针对性 ESLint 与 TypeScript 检查通过。
- 报告：`.cache/workflow-parameters-pty-results.json`。

命令：在 app 目录设置 TANDEM_TEST_BASH 为本地 PortableGit 的 bin/bash.exe，运行 vitest 的 pty-integration.test.ts，筛选 `workflow multiline arguments on actual PTY`，maxWorkers=1。测试使用现有有界 PTY 夹具，正常关闭终端并清理本次临时目录。

## 验收边界

A11 按原始参数防注入范围标为 verified。此处验证流程参数编译与实际执行，不等于 F11 的全部流程管理、父任务、恢复与导入导出，也不解决 R09 待决策的 secret-ref 传输语义。未重新执行 MCP stdio 或所有自动/协作模式矩阵；这些由各自标准保留原证据和未完成项。没有放宽脚本审查、控制权或命令策略。
