# 实际命令输出不完整时暂停并要求人工核实

2026-09-14，继续A15。本轮区分普通历史/分页展示截断与受控命令执行结果捕获不完整；前者不因本次修改停止任务。

## 发现与修复

执行器返回truncated=true，或返回文本超过网关256000字符保留上限时，原网关只标记outputTruncated，退出码0仍可使计划继续。另一个缺口是TaskRuntime.projectOperation只标记分页裁切，完整详情会丢掉执行层已有的outputTruncated。

网关现在将这类整体结果标为unknown，保留已确认exitCode，设置COMMAND_OUTPUT_INCOMPLETE并撤销本任务租约；沿用既有人工核实流程，而不是将已确认退出码改为null。任务停在paused-human，未核实直接重新授权返回RECONCILIATION_REQUIRED，后续命令不派发。真实中断/协议错误仍优先使用已有原因。

任务投影保留底层真实截断标记，同时继续支持普通分页裁切标记。TaskPanel显示专门中文原因；OperationOutput对此类结果显示“查看已保留输出”，不承诺找回已丢失内容。中英文/简繁体及其他语言回退键齐全。

依赖方向仍为执行网关→任务投影→既有类型/界面，不新增共享抽象、数据库结构或授权接口。状态使用既有unknown，新增错误字符串；没有把显示层裁切反馈给执行层当成真实缺口。

## 验证与失败记录

- 四项新运行时用例：自动/协作×执行器截断标记/网关容量超限，修改前均失败；最终要求暂停、保留退出码0和截断标记、下一命令未执行、人工可输入、重新授权必须核实。TaskRuntime全组51项通过，既有分页测试也通过。
- 中间实现仅保留成功状态并加error不适合现有unknown/failed核实入口；最终采用结果待核实并保留退出码。最初测试期望paused-error，实际租约撤销路径是paused-human，按实际暂停契约校正；没有接受继续执行。
- 详情未传递底层截断标记的新断言失败后，修复projectOperation并通过。
- 两项中文TaskPanel测试最初揭示未知操作行没有展示该具体原因，新增明确提示后，与AI运行时合计2文件40项通过。
- 网关与AI恢复原组合第一次并行检查有2项恢复状态未在原等待期限内完成；未改变测试或期限，独立13项通过，原组合/原并发复测149项通过。不能仅据复测断言初次失败原因已完全证明，保留全部日志。

最终相关5文件合计240项通过；TypeScript、ESLint及翻译键检查通过，缺失键0。日志incomplete-output-before.log、after.log、final.log、verified.log、ui-ai.log、ui-final.log、related.log、recovery-recheck.log、related-recheck.log、tsc.log、lint.log、locales.log均位于.cache并带incomplete-output-前缀。

本轮尚未用重新打包的客户端执行真实输出捕获超限场景；A15真实审计不可写/输出缺口整体验收继续保留。现有公开包未更新，整体57/79。未推送Git或触发Actions。
