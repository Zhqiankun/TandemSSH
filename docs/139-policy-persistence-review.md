# 规则保存失败与序列化重载验证

2026-09-12。新增 policy-persistence.test.ts，直接调用 tasks/production 的 readPolicy/savePolicy 与真实 SessionControl，隔离设置存储和审计端口，不触碰用户数据库。

5项通过：审计失败不调用存储、存储明确失败保留原规则；两种失败均已撤销旧控制租约，更新标记清理后可重新保存。挂起审计时同用户第二次保存返回 POLICY_UPDATING，首次完成后旧 expectedRevision 返回 POLICY_CHANGED。序列化保存的规则经生产模块重新导入可读回，其他用户保持独立默认版本；损坏存储返回 POLICY_UNAVAILABLE而不是启用默认规则。

初步阅读曾怀疑接管通知失败会泄漏 updating 标记；继续核对 SessionControl.changed 后确认通知与监听器异常已经隔离，该怀疑不成立，因此未修改生产代码。首轮测试还因误读快照字段 owner（实际为controller）而失败；修正测试并将挂起保存释放放入finally后复测通过，避免夹具污染下一项。

本证据是生产函数配合内存存储端口的故障注入与模块重载，不代表真实 SQLite 断电持久性、OS进程重启或磁盘提交后响应丢失。R08的真实持久化及完整桌面规则管理验收仍保留。ESLint通过，本轮只增加测试和证据，没有模块或产品依赖变化。
最终 tsc -b 类型检查通过。
