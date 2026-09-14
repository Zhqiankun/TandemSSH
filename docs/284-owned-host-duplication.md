# 主机复制保留认证，秘密留在服务端

2026-09-13，F01 / B01 局部修复。

问题：SidebarTree 原复制逻辑从脱敏的前端 Host DTO 拼装完整新主机，将 authType=key 改为 password 且丢弃密钥。密码和其他协议秘密同样不能从脱敏 DTO 完整复制，复制后连接可能不可用；还易遗漏新增配置字段。

现在：

- HostRepository.duplicateOwnedForUser 从 owner + hostId 查询原记录，验证当前数据密钥，在仓储内部解密后重新加密保存。保留认证类型、密钥/密码/凭据引用、备注、分组和连接定义。
- 新建独立 id / syncId / 时间戳，不继承原主机信任字段、自启动秘密。副本关闭自动监控、隧道自启动及 Docker/Proxmox/Tmux 后台启用；保留对应定义和采样周期。新主机不复制另表的信任/共享记录。
- POST /host/db/host/:id/duplicate 经过既有身份及数据解锁中间件，拒绝 API Key / 无身份，只接受 strict {name} 和正整数 ID。仓储只能复制本人主机；响应明确投影为 {id}，不包含认证材料。服务端错误固定为安全错误码。
- UI 新 duplicateSSHHost 适配器负责调用、缓存失效及既有同步触发。复制按钮不再拼装秘密字段，名称使用中文“（副本）”，成功提示说明保留认证、后台停用及首次连接需确认身份。

职责：仓储拥有加密记录复制和新身份；路由拥有协议校验及响应白名单；API 适配器和 SidebarTree 拥有用户操作。未新增通用共享抽象、数据库迁移或反向依赖。

验证：真实 SQLite 与实际字段加解密验证 key/password/credential 三类认证保留、源记录不变、独立 syncId、信任/自动启动清除、备注分组保留、其他用户无法复制、非法名称及数据锁定失败不插入。测试仅用固定密钥替代会话解锁入口，没有把假密钥当真实 SSH 登录证据。

真实回环 HTTP 测试使用测试身份中间件，验证 strict body、秘密字段注入拒绝、API Key/无身份拒绝、404/500 和响应白名单；即使仓储 mock 多返回 key 字段，HTTP 仍只有 id。不将测试中间件称为实际登录 JWT 验收。

共 2 文件 6 项通过，日志 .cache/host-duplicate-final.log。首轮从错误 cwd 运行仓储测试，找不到 app/drizzle/sqlite；改回 app 工作目录后通过。TypeScript、汉化检查通过（缺失键 0）；ESLint 0 错误，SidebarTree 既有 CLICK_CHEVRON_EXTRA 依赖警告 1 项。未顺手重构该无关依赖。

剩余：尚未重新打包和执行实际 UI 复制→SSH 登录，源主机为共享而非本人所有时不支持复制其认证材料；整项 F01/B01 继续未完成，计数 38/79。未提交、推送、打标签或触发 Actions。
