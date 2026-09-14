# 侧栏显示配置备份与恢复

2026-09-14。本轮补齐设置迁移的一项实际遗漏，不单独关闭 F14/B15/A37。

## 行为与边界

- 导出当前桌面侧栏显示设置，保存在 appearance.hiddenRailTabs。存储继续采用已有的 JSON 数组文本，无数据库迁移。
- 用户勾选“同时恢复外观、侧栏显示、界面偏好……”后，数据库及本地配置才恢复此字段。界面继续明确提示手动重新加载。
- 老备份缺少字段时保留目标设置；新备份的空数组明确表示全部显示。
- 只迁移入口可见性，不迁移 AI 启用开关、管理员禁用开关、命令策略和任务授权。导航显示不构成执行授权。
- 校验 JSON 数组、数量、长度及标识字符；去重。允许有界的未来版本标识，避免前后端依赖页面导航注册表。未知标识不会创建入口或授予功能。
- 本地存储写入失败沿用回滚与重试；预览后数据库侧栏配置发生变化会使确认失效，避免覆盖后来修改。

## 文件责任与依赖

types/desktop-preferences.ts 拥有可移植显示契约；ui/settings/desktop-configuration.ts 适配 localStorage；ConfigurationBackupRepository 负责数据库快照、变更指纹与显式恢复。前后端都依赖类型层，不引入后端到 UI 的依赖，也未新增共享模块。中英文恢复选项说明同步更新。

## 验证

- 3 个测试文件共 56 项通过，无跳过：desktop-configuration、configuration-backup-repository、schema-service。
- 覆盖真实 SQLite 存储、未勾选保留、勾选恢复、AI 开关不变、旧备份兼容、预览冲突、导入导出预览往返、畸形数据拒绝、本地写入失败回滚。
- tsc -b、修改文件 ESLint 通过；中文资源检查缺失键 0。
- 测试日志：.cache/navigation-backup-tests.log。

## 剩余范围

本轮未将设置迁移整体标记完成，仍需覆盖既有记录中的实例级 host_defaults、本地活动 C2S 等剩余设置范围。未声称做过这次新增字段的 Windows 安装包界面验收；现有 win-unpacked 尚未包含本次改动。最后统一 Git 推送及 Actions 发布的安排保持不变。

生产构建 npm run build 通过，日志 .cache/navigation-backup-build.log；存在既有大资源块体积提示，不影响此次构建。
