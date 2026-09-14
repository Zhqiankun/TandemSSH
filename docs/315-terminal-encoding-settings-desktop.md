# 终端编码选择控件的桌面保存验收

2026-09-13，承接 314。使用当前编码目录包，实际打开专用主机编辑器的 SSH → 终端页，操作 host-terminal-encoding 下拉框，依次选择 GB18030、Big5、Shift_JIS、UTF-8，点击“更新主机”。每次通过实际主机读取接口核对已保存的 terminalConfig.encoding，再重新打开编辑器核对控件值。

成功报告 `.cache/desktop-observation-report-515f4ee5-a48f-482b-9174-7e48a276565a`，encoding-settings-result.json 全部通过；已查看 encoding-settings.png，编码标签和“修改后重新连接生效”中文说明正常。程序和 runner 正常退出，日志不含固定认证秘密。

最初脚本在保存/取消后立即查找列表行，得到 undefined 而失败；失败状态显示“主机已更新”。增加等待实际列表行重新出现后重跑完整四项，成功；没有将测试时序问题当作产品修复。首个失败报告 f6864c38-84ed-449c-a4e6-fb70ada07c24 保留。本轮无产品代码改动。

脚本 .cache/run-encoding-settings.cjs、encoding-settings-observer.cjs；日志 .cache/encoding-settings-desktop.log。本轮证明设置控件保存/重开，输入输出字节证据见 314，不将保存过程当作修改活动连接编码的证明。

附加路径审查：terminal/index.ts 的启动目录与 executeCommand 已使用编码边界；tmux helper 的 attach/create 仍直接写 UTF-8 文本，且 tmuxCommand 固定使用 tmux -u。旧编码终端与 tmux 的编码切换、名称及控制路径需要单独处理，尚未实现或验证，不能宣布完整终端编码验收完成。F03/B03 未完成，44/79 不变；未推送或触发 Actions。
