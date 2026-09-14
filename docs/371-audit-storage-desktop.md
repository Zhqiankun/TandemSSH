# 真实审计存储不可写与 A15 验收

2026-09-14。原始A15：审计不可写/输出有缺口，暂停自动副作用，人工可接管，记录缺口可见。本轮没有修改生产代码。

## 真实文件系统故障

独立Windows客户端与本轮Alpine 3.24.1 SSH，经MCP配对打开会话。为自动/协作各建立两步固定计划：首步打印AUDIT_STARTED标记后等待本轮远端gate文件；第二步打印FORBIDDEN_AFTER_AUDIT标记。通过中文表单核对并授权，协作逐条批准。

确认首步实际打印标记后，将该独立资料目录的用户审计目录移动到同一审计根中的备份位置，再用本轮普通文件占用原目录路径。所有路径先校验realpath、父目录、用户散列目录名和备份不存在；这使实际AuditJournal的mkdir/追加写路径失败，没有替换产品内部审计返回值。

随后通过独立SFTP放行首步。两个模式均确认：首条命令succeeded且exitCode0，auditGap=true；仅一条操作，第二步没有派发；控制权human；中文界面显示“操作记录写入失败，自动执行已暂停。”。在故障保持期间用真实终端键盘写入独立MANUAL标记文件，通过另一个SSH/SFTP连接读回准确内容，证明人工操作不依赖可写审计。

核对占位文件内容及身份后仅删除本轮占位，恢复原审计目录。存储恢复后原操作auditGap仍为true，没有把缺失的完成记录假补成成功。最后显式取消测试任务。

## 原始结果与资源

报告.cache/desktop-observation-report-c28ad0d7-4b5a-4295-9dce-997d9ca51fad/audit-storage-result.json已读取，两种mode全部通过。实际查看audit-unwritable-collaborative.png，首步退出码0、成功事实、红色审计缺口与人工控制可见。

脚本.cache/run-audit-storage-native.cjs、audit-storage-native-body.txt；日志audit-storage-native.log。客户端正常退出、脚本exit0，审计目录全部恢复，MCP配对撤销、测试gate及标记文件清理。Linux实例2b25c186-5a9c-4837-bc29-d1dd9bd8eb5c关机超时后forced=true，启动器vmExited/code0；不是正常OS关机。日志audit-storage-linux-launch.log、audit-storage-linux-stop.log。

故障类型是本轮审计目录路径被普通文件占用造成的真实文件系统错误，不宣称填满宿主磁盘或更改系统ACL。本轮没有调用模型服务，执行走与AI/MCP共享的TaskRuntime/OperationGateway。

## 原始条款组合

| 条款 | 直接证据 |
| --- | --- |
| 审计不可写时停止自动副作用 | 367创建失败取消未绑定任务且不可授权；网关既有派发前审计检查；368完成后审计缺口停止后续；本轮真实存储故障双模式 |
| 输出有缺口时停止并保留事实 | 369实际捕获截断进入unknown、保留退出码并要求核实；370真实Linux输出300KB的双模式暂停/人工跳过/续跑，不重跑原命令 |
| 人工仍可接管/操作 | 368运行时和中文组件；370及本轮真实SSH标记与独立读取 |
| 缺口可见 | 368中文role=alert，369保留底层截断标记及准确查看文案，370实际中文输出缺口，本轮实际审计缺口且恢复存储后仍保留 |

对不可写期间缺失的事件不声称能够重建。历史导出的损坏/缺失提示和不完整流拒绝另见77；不承诺所有存储介质故障下的日志完整性。

依据A15原始范围标记verified，整体58/79。其他授权、导入、终端、隧道及设置条目继续独立验收。未推送Git或触发Actions，公开安装包未更新。
