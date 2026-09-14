# S2S全局启动准入

2026-09-14。新增S2SStartAdmission，在任何异步清理前同步登记启动名额。活动runtime/SSH连接、等待重试、连接中和当前启动请求名称共同计算，最多32个不同名称；同名最多8个并行启动调用。release计数幂等，重叠旧调用结束不能提前释放另一个调用的名额。

manager的公开connectSSHTunnel包装原连接流程，try/finally释放启动登记；原连接/重试/清理行为在内部attempt保持。现有live名称可重试，不重复占总名称名额。拒绝抛出S2S_TUNNEL_LIMIT/S2S_START_LIMIT，由已有路由失败状态处理；隧道页面新增中文原因映射。

启动准入模块属于S2S manager领域，不依赖页面或数据库私有状态；manager提供当前资源名称快照。无通用共享抽象。

新增纯准入用例验证32名称、8同名、幂等释放与保留活跃名额。集成用例实际调用32个manager启动并挂起DNS，等待确认32次查询进入，再验证第33名称拒绝且SSH客户0；清理并放行后，第33名称正常连接，人工信任通过后connected=true，再停止清理。

准入和真实隧道回归共2文件70项通过，日志.cache/s2s-start-capacity-final.log。此为真实管理器+SSH集成、受控DNS等待，不称为32台真实服务器并发压力测试。本轮尚未打包S2S界面限额，整体65/79。未推送Git或触发Actions。

最终tsc -b、修改文件ESLint及本地化检查通过，日志s2s-start-capacity-final-types.log、s2s-start-capacity-lint.log、s2s-start-capacity-localization.log。
