# 本地 C2S 普通导入的 Windows 验收

2026-09-14。补齐467刻意中断流程以外的普通中文页面导入路径。

通过真实桌面创建隔离来源主机和local/remote/dynamic三项配置，经“预览导出”“确认并下载”得到备份。通过文件选择控件选择下载文件，确认本地C2S选项默认不勾选，只勾选这一项后点击“确认并导入”。其他偏好恢复选项保持关闭。

确认后新增主机使用新ID、authType=unconfigured；本地原三项、人工新增一项和导入三项合计7项，人工配置保留。导入配置全部禁用且无旧来源审阅状态，待恢复记录已确认清除。关闭再冷启动仍为2台主机、7项本地配置，无重复恢复。

原始报告：
.cache/desktop-observation-report-93422f04-e2d3-4faa-b8af-6c4c21502890
- normal-import-result.json 已直接读取，普通UI路径、默认关闭、单独选项、新主机未认证、手工配置保留与禁用均通过。
- 同目录名加 -restart/recovery-result.json 已读取冷启动验证。
- ssh-attempts.json 为0。每次检查任务/会话和C2S运行状态为空，所有本地配置端口可绑定。
- normal-local-import.png 已实际查看：中文成功提示要求重新配置主机凭据、重新选择SSH主机并审阅后启动。
- 两次应用cleanExit、执行器退出0并释放业务端口。
- 脚本.cache/local-c2s-normal-observer.cjs、run-local-c2s-normal.cjs，日志.cache/local-c2s-normal.log。

脚本沿用三阶段运行器产生的第三个 -verify 目录本轮没有执行；只以上述正常导入与一次冷启动为证据，不将空目录计为额外验收。没有修改生产代码、发布或推送。
