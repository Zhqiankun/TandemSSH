# 已发送命令的真实桌面接管与 A05 验收

2026-09-14。原始 A05：派发瞬间接管，已发送动作可见、未发送动作取消、状态与事实一致。本轮只增加验收脚本和证据，没有修改生产代码。

## 真实远端与中文界面

独立 Windows 客户端通过本产品 MCP 配对与 38 项工具接口打开本轮 Alpine 3.24.1 SSH，会话指纹在中文窗口核对。自动和协作分别建立两步固定计划；协作首步明确批准。

首步 sh 写入 STARTED 标记后等待本轮 gate 文件，放行后写入 FINISHED 标记。通过另一个 SSH/SFTP 连接读取准确 STARTED 内容，确认远端已执行，不以命令回显推断。此时任务唯一操作状态为 running。

点击中文“立即接管”后，任务控制权 human，原操作变为 unknown；真实 DOM 中对应操作保留 sh 和“结果未知”。独立检查 FINISHED 尚不存在，再通过 SFTP 放行首步，读回准确 FINISHED 内容，证明已发送操作仍可能继续完成。

随后使用真实终端键盘写入 MANUAL 标记，通过独立 SFTP 读回准确内容。最终仍只有同一个操作 ID，unknown 且没有已确认退出码；第二步对应的 FORBIDDEN 文件始终不存在，控制权保持 human。没有根据独立验收连接观察到的事实，替产品伪造已失去的完成通知。

## 原始结果与资源

报告 .cache/desktop-observation-report-1323a99a-eecc-46c4-bbb1-54ee9c65fbe9/dispatched-takeover-result.json 已读取，两种模式所有断言通过。保存 dispatched-takeover-automatic.png / collaborative.png；中文可见性以实际 DOM 断言为证据。

脚本 .cache/run-dispatched-takeover.cjs、dispatched-takeover-observer.cjs、dispatched-takeover-body.txt；日志 dispatched-takeover-native.log。客户端 cleanExit=true，脚本 exit0，业务端口释放，MCP 配对撤销，夹具自有远端目录清理。

Linux 实例 9d52d578-df78-4a34-9ef4-9e90df8d93ef 关机超时后 forced=true；启动器 vmExited/code0。日志 takeover-linux-launch.log、takeover-linux-stop.log。不能称为正常 OS 关机。

## 条款对应

| 原始要求 | 证据 |
| --- | --- |
| 已发送动作可见 | 本轮真实远端 STARTED 与界面 running，接管后同 ID、原命令及中文 unknown 保留；106 中文组件与 MCP 读取补充 |
| 未发送动作取消 | 373 两种模式在 prepare/intent/beforeSend 的六种确定性竞态：首操作及已排队操作 cancelled-before-send、零写入、去重不重发；本轮真实客户端停止后续派发 |
| 状态与事实一致 | 373 无 startedAt、完成审计与返回状态一致；本轮远端放行后实际完成但客户端仍保留未知，人工操作独立读回成功 |

边界：派发前最窄竞态由受控适配器验证，本轮桌面接管发生在独立确认已发送且仍在执行之后；不宣称采样了所有 CPU 调度或网络时序。该组合覆盖 A05 原始要求，不保证接管撤回已经交付远端的字节。

依据以上组合标记 A05 verified，整体 60/79，仍有 19 条未完全验收。未推送 Git、未触发 Actions，公开安装包不变。
