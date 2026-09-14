# 重启后从中文桌面查阅已归档任务

2026-09-13，承接 278，F08 / R05。重新构建本地 Windows 目录包，使用 277 正常退出后保留的同一测试 profile 重启。Linux VM 保持关闭，本轮不新建 SSH 任务。

通过实际首页“操作历史”按钮打开弹窗，在任务 ID 表单中分别筛选原 automatic / collaborative 任务，点击归档记录的“查看详情”：

- 中文列表显示“已人工核对 1 项未知命令；原执行结果仍为未知。”
- 详情保留 task.archived、cancelled、原 reviewedUnknownOperations ID 与 unknown 状态。
- 重启后的真实历史 HTTP 查询还确认人工 task.authorization、agent 操作、主机快照、策略版本及输出片段；协作链包含人工 operation.approval。
- 应用正常退出、端口释放，观察器退出码 0。

成功报告 `.cache/desktop-observation-report-31a270eb-21a8-4202-acbd-ca497d26c1ef/history-reopen-result.json`。已查看 `history-review-collaborative.png`，截图中同时可见原始 JSON、协作来源、服务器、已取消状态和中文人工核对摘要。服务器离线时仍能读取历史，未依赖存活的 TaskRuntime 任务对象。

首轮 `.cache/desktop-observation-report-95edf1a2-5e3e-4c75-8b1c-20e87511cb8c` 接口读取成功，但脚本直接发送打开事件后未见弹窗，等待超时。改为点击真实首页按钮并通过实际筛选表单后成功。未修改生产代码，尚未确定首轮早期事件丢失的具体原因，不能据此声称修复了某个已定位的启动竞态。另外脚本校正了审批事件名称为实际 operation.approval。

此前 79 的 Windows MCP 历史显示、143 的六种来源/模式运行时→磁盘往返、276–278 的归档与摘要证据保留。本轮把新摘要的打包重启验收补齐；文件失败/中断等完整记录矩阵仍需继续核对，F08/R05 不因这两个任务就整体标记完成。计数保持 35/79。

构建日志 .cache/history-reopen-build.log / history-reopen-package.log，运行日志 .cache/history-reopen-desktop.log。未提交、推送、打标签或触发 Actions。
