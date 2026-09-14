# 命令副作用后断线与 A14 原始验收

2026-09-14。原始A14：“命令执行后断线：标为unknown，检查后才允许重试”。本轮无生产修改，补齐真实副作用后断线证据。

## 真实桌面与远端事实

当前Windows目录包连接本轮Alpine 3.24.1，客户端SSH流经过仅转发该VM端口的TCP代理；独立直接SSH/SFTP连接用于观察文件。自动和协作各执行两步：首步sh向独立文件追加x后sleep20，第二步touch禁止标记。协作首步得到明确单条批准。

独立SFTP读回内容恰为x后，才切断客户端代理连接；因此断线不是发生在命令派发前，也不以终端回显推测副作用。首步状态unknown、exitCode未确认。恢复代理后点击实际中文重新连接，新会话控制者为human。

自动模式旧授权返回SESSION_NOT_FOUND，协作旧批准返回STALE_APPROVAL。旧任务保持停止，操作数量不增加，禁止标记不存在；副作用文件仍恰为x，没有重放。重连后实际键盘printf返回Linux终端标记，人工操作可用。

报告.cache/desktop-observation-report-60e73b33-0e4e-4fca-a5b5-238d691f33f2/sideeffect-disconnect-result.json已读取，双模式全部通过。脚本sideeffect-disconnect-observer.cjs、run-sideeffect-disconnect.cjs；日志sideeffect-disconnect-native.log。客户端cleanExit=true、脚本exit0，业务端口、TCP代理及夹具文件清理。

VM9678e769-7d21-469d-923f-020f9abb0715关机超时后forced=true，启动器exit0，不能称为正常OS关机。日志sideeffect-linux-launch.log、sideeffect-linux-stop.log。

## 检查后才允许重试

本轮当前回归gateway、TaskRuntime恢复、AiTaskCoordinator共3文件193项通过，日志.cache/sideeffect-recovery-tests.log。其中MCP未知结果保存并恢复到新会话后，未提供reconciliation时RECONCILIATION_REQUIRED且零写入；人工选择skip后才可授权。AI未知结果同样不能直接继续。

247真实Windows/Linux四组合补充实际人工核实后的skip/retry：原unknown操作保留，成功首步不重跑，协作恢复继续逐条批准；300/本轮证明实际断线不继承旧控制权。277证明归档也要明确核实，不能通过归档伪造已知结果。

这些证据分工明确：本轮是真断线后已产生副作用的unknown和不自动重放；恢复门禁由当前真实运行时与已有桌面人工恢复组合验证，不冒充本轮已经在同一个断线案例里执行重试。

按原始A14范围标记verified，整体64/79，剩余15条。未知必须由用户在服务器核实，系统不保证能自动判断所有远端副作用。未推送Git或触发Actions，公开安装包不变。
