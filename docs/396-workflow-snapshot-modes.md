# 普通流程参数快照双模式复核

2026-09-14，继续R09/F11/B14，不缩减08-workflows明确要求的secret-ref范围。

工作流库的既有参数快照/重复启动测试扩展为automatic、collaborative两种模式：预览后修改调用方参数对象和返回的命令数组，真正创建任务仍使用原始展开值；相同预览与requestId重复开始只创建一次；改用另一模式重用预览被拒绝。

当前还复测定义参数、父流程、内置AI调用和中文流程库：普通string/integer/boolean/enum/remote-directory规则、特殊字符保留为单个参数、显式目录与共享Shell语义、每步策略校验、父流程禁止旁路命令、未知结果核实与恢复、导入审阅均沿用对应测试。日志.cache/workflow-snapshot-current.log。本轮只改变库测试，不新增生产模块或依赖。

secret-ref在08中是明确需求，不是额外建议，当前SECRET_TRANSPORT_UNSUPPORTED仍构成功能缺口。再次向用户提供115所述执行通道选择：独立无PTY标准输入，或必须继承交互Shell环境。该选择影响共享Shell语义，尚未得到具体答复；不能用“所有操作批准”推断用户选择了哪种行为。等待期间普通流程工作可继续。

本轮不把安全存储或普通参数通过称为秘密步骤已实现，也不因此关闭R09/F11。现有工作流/参数桌面证据由15/113/247/267/324保留，未冒充本轮新实测。整体64/79。未推送Git或触发Actions。

当前5文件64项通过，tsc -b与修改测试ESLint通过，命令链exit0；日志workflow-snapshot-types.log、workflow-snapshot-lint.log。
