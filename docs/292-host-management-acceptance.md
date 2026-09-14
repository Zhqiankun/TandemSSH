# 主机导出往返、最近连接与管理验收归并

2026-09-13，F01/B01。

## 实际导出与重导入

当前 Windows 目录包在独立 profile 创建 SSH 与 RDP 网关测试配置（固定测试秘密，不连接服务器），通过真实导出菜单和确认按钮下载两份 JSON。无凭据 HTTP 响应与实际文件都不包含已知顶层密码、终端 sudo 密码、代理链密码、网关密码；显式勾选包含凭据后的下载保留四项测试值，预览全部遮盖。已查看 host-export-preview.png，中文“导出”“包含凭据（密码、私钥）”与 <included> 正确显示。

通过 API 删除测试源记录作为往返准备，再用真实文件输入选择刚下载的无凭据原文件，原生中文确认框显示两台主机、文件名和凭据数量。确认后两台配置恢复，中文备注与分组保留，自动采样/自启动停用。SSH 主机进入 unconfigured 状态，从实际终端入口显示重新配置凭据提示。

成功报告 `.cache/desktop-observation-report-e5978e3c-f7f9-4375-9d89-8aed2afcf2de/host-export-roundtrip-result.json`；应用正常退出、端口释放。

首轮 78809376-1024-4f5f-8359-7eb2809fd02b 的真实下载通过，但 SSH 重导入失败：无凭据文件仍声明 password，导入器要求密码。修复为无凭据 SSH 导出标记 unconfigured，旧导入器接受此状态并清除所带密码/密钥/凭据 ID；复用既有 HOST_CREDENTIAL_REBIND_REQUIRED 连接保护，不降级为免认证，也不自动选用本机凭据。完整凭据导出不改动，显式 none 保留。服务端、真实 HTTP/SQLite 导入、连接保护、前端构造/对话框联合 5 文件 91 项通过，ESLint及构建类型检查通过。实际往返随后重跑通过。

## 最近连接重启与时区

重启 285 的实际 SSH 测试 profile，读取其真实密钥/密码主机与副本连接记录。初次中文显示通过但显示为 8 小时前，不能据此认可时间准确。SQLite CURRENT_TIMESTAMP 是无时区文本形式的 UTC，界面按本地时间解析导致偏移。

RecentActivityRepository 现只对 SQLite 的该文本形式补上 ISO UTC 标记，已有带时区文本与其他方言保持原状；SQLite 查询和保留裁剪按 julianday 排序并以 ID 稳定排序，防止旧 SQL 格式与 ISO 格式混合时按文本排序错误。仓储与时间/组件联合 3 文件 9 项通过，TypeScript、ESLint通过。

更新后端构建并重新打包（前端仍为本轮已构建的同一资源），再次重启同一 profile。实际 API 时间戳与原 SSH 验收报告文件生成时间相差小于 10 分钟；界面显示正确的“1小时前”。成功报告 `.cache/desktop-observation-report-5e3b9e3e-7d69-4df1-aed6-7eb3e17eb547/recent-connections-result.json`，截图已查看，四条终端记录可见；客户端正常退出。首次最近连接观察脚本变量 screenshot 重名，修复脚本后运行，未修改产品以绕过检查。

## 原始要求对照

- 新增、编辑、删除确认、备注、分组归属、置顶：288 的真实中文界面与实际数据库。
- 复制：284 的所有者加密复制、密码/密钥/凭据引用数据库及 HTTP 约束；285 的 key/password 真正复制菜单→独立身份确认→副本 SSH 命令。
- 搜索：286/287 的备注/分组和父子层级修复，288 的当前包真实搜索。
- 最近连接：本轮真实旧连接记录重启读回、中文显示及时间对照。
- 配置导入导出：本轮实际下载和原文件重导入；193–196 的 JSON/SSH 配置确认、新增/覆盖 HTTP、默认停用及桌面结果；54 的普通配置备份实际导出/恢复。

按 F01/B01 原始主机管理范围标记 verified，总计 40/79。此结论不扩展为所有认证方式的连接矩阵、任意高级配置迁移或任意文本秘密检测；这些继续由 B02/A22 等原条目验收。截图所示秘密均为测试数据，未使用个人主机或真实凭据。

证据日志：.cache/share-import-auth-tests.log、share-import-auth-lint.log、host-export-native-build.log、host-export-native-package.log、host-export-native-desktop.log、recent-utc-tests.log、recent-utc-tsc.log、recent-utc-package.log、recent-native-desktop.log。未提交、推送、打标签或触发 Actions。
