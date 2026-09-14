# 管理员主机默认配置真实桌面验收

2026-09-14。为461新增功能补齐当前 Windows 目录包的实际操作验证。

## 流程与结果

在独立新建配置中，经真实后端设置源默认值：21号字、monospace、代理地址/端口/用户名、启用意图、光标及历史/记录/监控开关；使用纯测试密码与旧凭据编号。通过中文“预览导出”和“确认并下载”下载格式3备份，逐字比较下载与预览；检查 hostDefaults 内容完整，密码和 credentialId 不存在。

随后设置不同目标默认值及另一组测试认证。选择下载文件，检查三个恢复选项均默认关闭；仅勾选管理员默认值时其他两个选项仍关闭，再显式选择本次同时验收的外观和快捷键选项。确认导入后读真实 /users/host-defaults：内容与源可迁移字段一致，useSocks5=false、credentialId=null、无 socks5Password；目标旧认证未保留。

界面显示中文恢复成功与“代理保持停用，重新配置凭据后核对启用”的提示，截图已实际查看。手动重新加载后仍正确，随后关闭应用并以同一配置冷启动，默认值及认证清除状态继续保留。既有侧栏、主题字号强调色和快捷键审阅流程同步回归通过。任务和会话列表保持为空。

## 原始证据

- .cache/desktop-observation-report-a3e419df-80cf-45e6-947a-9ca659ee611e/application-settings-result.json，已直接读取全部断言。
- 同一目录 host-defaults-restored.png，已实际查看中文结果界面。
- 同目录名加 -restart/settings-restart-result.json，已读取冷启动结果。
- 两次应用正常退出、执行器退出0，业务端口释放。
- 脚本 .cache/host-default-backup-observer.cjs、run-host-default-backup-native.cjs。
- 日志 .cache/host-default-backup-package.log、host-default-backup-native.log。

## 边界

本轮桌面场景验证管理员正常路径。普通用户拒绝、预览后权限撤销、确认冲突及收据失败回滚由461的实际HTTP/SQLite测试覆盖，不声称这些故障都做过桌面点击复现。

当前本地测试目录包包含461及460功能。没有发布公开安装包、推送Git或触发Actions。主机默认配置迁移已有实现与真实桌面证据；F14/B15/A37剩余本地活动C2S等范围仍需继续，整体69/79不变。
