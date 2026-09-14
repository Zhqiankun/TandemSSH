# 历史保存的主机访问边界

2026-09-14，继续435与F03历史范围。

## 缺陷与修复

原/terminal/command_history保存入口只检查主机历史开关；主机查询返回null时仍继续create，且查询整条主机记录会经过凭据解密。findHostById的userId用于解密上下文，并不代表数据库查询已按该用户过滤，不能把这个参数误当授权证明。

现在先使用现有PermissionManager.canAccessHost(userId,hostId,"connect")，无访问权限返回404，避免区分目标不存在与无权访问。授权后查询主机历史开关，若主机已删除同样404，不创建记录。当前用户的自有/授权共享主机均沿用现有主机权限契约，未改成仅限所有者。

HostResolutionRepository新增findHostHistoryPreference，只投影enableCommandHistory字段，注释明确调用方先授权；该查询不读取认证字段或解密。保存入口的设置/权限/查询纳入原有try/catch，异常不继续保存。原敏感命令过滤、全局关闭和主机关闭行为保留，但均在授权与存在性确认后处理。

## 文件责任与验证

terminal.ts负责HTTP输入及授权编排；host-resolution-repository.ts负责非秘密字段查询；PermissionManager负责既有主机访问规则。无共享utils抽象、无数据库迁移、无页面依赖后端私有实现。

4文件70项通过，包含435非法编号矩阵、拒绝访问时不查主机设置且不写入、授权后主机消失不写入、关闭历史不写入，以及实际SQLite查询true/false/null结果。对DataCrypto.getUserDataKey/decryptRecord断言零调用，证明新查询不为读取历史开关解密凭据。日志.cache/history-access-tests.log。

路由测试调用已注册处理器，PermissionManager为受控授权结果；没有把它描述为本轮完整RBAC端到端或真实桌面历史采集。既有权限模块没有改变。本轮也不声称对授权检查后所有并发撤权窗口提供事务隔离。

总体验收67/79，F03完整历史/连接状态仍需实际场景证据。未重打包本轮源码、未推送Git、未触发Actions，公开安装包未更新。
最终 `tsc -b` 与修改文件 ESLint 均 exit 0，日志 `.cache/history-access-types.log`、`history-access-lint.log`。
