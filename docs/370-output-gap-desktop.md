# 真实命令输出超限的双模式桌面验收

2026-09-14，补369实际桌面证据。当前工作树重新build和打包，包含367创建审计清理及369执行输出缺口修复；没有公开发布。

## 场景与结果

独立Windows客户端，经打包MCP配对打开本轮Alpine 3.24.1 SSH。测试文件位于linuxFixture自身case-UUID目录，准确300000字节X。通过真实任务创建接口建立两步固定计划：cat该文件、printf独立NEXT标记；从中文界面授权，协作模式逐条批准。

自动和协作两种模式均验证：

- 实际cat退出码0，捕获保留256000字符，完整详情仍有outputTruncated=true，整体结果unknown且原因COMMAND_OUTPUT_INCOMPLETE。
- 后续printf未执行，只有一条操作记录，控制权human。中文界面显示具体输出不完整原因。
- 在同一SSH终端实际键盘输入printf，MCP在规定12000字符范围内读到只有真正执行后才产生的AFTER_MANUAL标记。
- 从核实选择器明确选择skip并重新授权；协作模式再次逐条批准。下一条printf成功并产生NEXT标记，原cat操作ID不变、仍unknown且记录reviewed.skip，没有重新执行cat。
- 任务最终completed-with-errors，不把原不完整结果改成完整成功。

报告.cache/desktop-observation-report-610ebe12-4c49-460d-b6eb-5c9a33369ec6/output-gap-result.json已读取。实际查看incomplete-output-collaborative.png，退出码0、结果未知、具体中文缺口说明、人工控制与保留输出可见。

脚本.cache/run-output-gap-native.cjs、output-gap-native-scenario.txt；最终日志output-gap-native-v4.log。前序脚本问题已保留：v1误用自由AI任务的textarea授权控件；v2终端读取超出12000参数上限；v3自动模式完成后，在协作固定计划中寻找不适用的整计划批准框。最终按实际表单和逐条审批流程完整重跑，未修改产品权限或接口上限来绕过。

## 范围与资源

本轮是真实Linux命令输出捕获超限，不是WebSocket丢包或磁盘审计不可写的实测。固定任务经同一TaskRuntime/OperationGateway执行，未调用模型服务。客户端正常退出、脚本exit0，MCP配对撤销、测试目录清理；测试机a603546e-1a9e-4286-8db7-65367bb1c150关机超时后forced=true，启动器vmExited/code0，不称正常OS关机。

构建与打包日志output-gap-native-build.log、output-gap-native-package.log；测试机日志output-gap-linux-launch.log、output-gap-linux-stop.log。A15当前还需真实桌面审计不可写等剩余边界闭环，整体57/79。未推送Git或触发Actions。
