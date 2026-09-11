# 规则通过真实加密数据库跨进程恢复

2026-09-12。桌面 SQLite 在内存运行，再加密持久化；不能用普通磁盘 SQLite 文件重开代替此机制。本轮新增 policy-storage-child.ts 与 policy-storage-process.test.ts，使用真实 db/index 初始化、SettingsRepository、工厂强制保存钩子、DatabaseFileEncryption 和策略 schema/求值器。

父测试生成 os.tmpdir 下限定前缀的随机目录和随机测试 DATABASE_KEY；两个独立 Node+tsx 子进程顺序执行。第一进程保存 revision=7，包含 global/group/host/task 四种 scope、严格白名单、精确参数与中文原因。仓库 set 返回后直接关闭内存数据库并退出，不调用额外 shutdown-save；已核对 exit 钩子也仅关闭连接。第二进程从相同加密文件启动，完整结构深比较相同，再实际求值确认全局 deny 仍优先于其他范围 allow，其他用户的策略键为空。

磁盘仅有 db.sqlite.encrypted，没有 db.sqlite；加密文件不含测试策略键的明文。测试结束检查临时目录绝对路径和限定前缀后清理，不访问用户数据库、不复用用户密钥。本测试不模拟断电/磁盘损坏，不等价于 UI 保存确认完整流程；与139的生产保存函数故障注入互补。

实际跨进程测试通过（扩展四级规则后2.74秒），ESLint通过。模块责任：新文件只属于backend/test-helpers及测试，不新增生产依赖或改变现有存储方式。R08的真实加密持久化证据已补齐，桌面规则管理及其他原始范围继续验收。
最终 tsc -b 类型检查通过。
