# 主机终端编码备份恢复

2026-09-14。补齐 F03/B03 与 F14/B15/A37 交叉处的实际缺口：原有备份只投影终端显示字段，主机 encoding 在导出时丢失，恢复后会采用 UTF-8，无法保留已配置的旧编码。

## 契约与文件责任

types/configuration-backup.ts 为 BackupHost 与主机预览增加可选 terminalEncoding，复用 types/terminal-encoding.ts 的四种编码。它独立于 terminalAppearance；继承字体主题不会覆盖 SSH 字节编码。

configuration-backup/terminal.ts 负责从主机 JSON 投影编码；schema.ts 校验导出/导入，仅允许 utf-8、gb18030、big5、shift_jis。格式 3 添加可选字段；既有格式 3 缺失字段保持原先默认行为，格式 1/2 的同名扩展字段忽略并提示，避免错误解释旧扩展。非法新编码导入失败，非法已保存编码导出时剔除并产生已有警告。

service.ts 将相同编码送入预览摘要、完整内容与冻结的确认参数。ConfigurationBackupPanel 使用已有“终端字符编码”词条，在确认前显示每台主机编码；旧文件未指定时显示 UTF-8。

ConfigurationBackupRepository 在同一个恢复事务内写入新主机 terminalConfig.encoding。主机编码跟随主机恢复，不依赖用户偏好恢复勾选；新主机仍无认证绑定、无自动隧道、无状态探测，必须重新绑定认证并手动连接。无数据库迁移、无新的共享抽象、无页面向后端私有实现的依赖。

## 验证

6 文件 73 项通过：四编码导出/JSON 解析往返、显示继承独立、启动字段排除、旧版兼容、非法编码拒绝、预览摘要/完整内容/确认参数一致、中文预览确认前不写入、真实 SQLite 恢复持久化、偏好默认关闭、重复确认幂等、另一用户不受影响及既有回滚/预览失效回归。

日志 .cache/backup-encoding-tests.log；规范检查 .cache/backup-encoding-lint.log exit 0；中文词条检查 Missing literal translation keys: 0。

## 保留范围

本轮未完成实际 Windows 客户端导出→导入→重新配置认证→连接旧编码 SSH 的完整重测，不能用组件和数据库测试冒充桌面验收。实例级 host_defaults、本机活动 C2S 配置、系统剪贴板、tmux 与旧编码兼容性等仍保留。67/79 总数不变。

未重新打包、未推送 Git、未触发 Actions，公开安装包未更新。
`tsc -b` 类型检查完成，exit 0；日志 `.cache/backup-encoding-types.log`。
