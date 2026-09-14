# 编码设置独立于外观继承

2026-09-13。HostEditor 的编码选择曾位于 disabled={inheritTerminalAppearance} 的 fieldset 中，开启继承外观会导致该控件也被禁用。315 的脚本直接设置 select 并触发事件，没有检查 :disabled，因此不能作为该状态下用户可操作的证据。

本轮将编码选择移到外观 fieldset 外，保持标签/说明与保存协议不变。加强原生脚本，实际开启“使用用户默认设置”，确认外观 fieldset.disabled=true 且编码 select.matches(':disabled')=false，再执行四种编码保存与重开。旧目录包报告 a1d40772-b76d-4bff-bde6-be6a2a3af8a3 明确失败：Encoding disabled by appearance inheritance。之前 bd04c64c... 为脚本选错 fieldset 的超时，不计产品失败证据。

修复后完整矩阵通过：.cache/desktop-observation-report-2ff6ec4f-6370-4320-9293-31f41d82be12。桌面正常退出，日志无固定认证秘密。原会话句柄在后续 turn 已不可用，依据完成日志与报告确认，不重复启动。构建日志 encoding-inheritance-build.log / package.log；运行日志 encoding-inheritance-after.log。

HostEditorData 新增继承外观时编码仍保存、未产生字体覆盖、重开仍保持继承的测试，共 43 项通过（encoding-inheritance-tests.log）。本轮仅调整 UI 归属，无新增业务模块或后端接口。整体仍 44/79，未推送或发布。
