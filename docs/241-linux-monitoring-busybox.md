# 真实 Linux 监控与 BusyBox 进程兼容

## 本轮范围和边界

使用项目隔离的 Alpine Linux 3.24.1、内核 6.18.35、2 个虚拟 CPU，通过校验主机指纹的真实 SSH 连接执行生产 MonitoringCollectionRuntime 和 CPU、内存、磁盘、网络、进程、系统采集器。没有连接业务服务器。

生产文件责任：collection-catalog.ts 维护固定只读命令；processes-collector.ts 解析进程数据；HostStatusWidget.tsx 展示未知占比。依赖仍为 UI 消费数据、采集器调用执行层，没有新共享抽象或任意命令入口。测试中的授权回调是固定测试身份，因此本轮不重复宣称实际账户权限链已验收。

## 发现与修复

修复前实际采样得到 total=96、running=null、top=[]。BusyBox ps aux 的表头为 PID USER TIME COMMAND，不提供 procps 的 CPU/内存占比列。

- 兼容识别该表头并保留 PID、用户和命令；缺失占比用 — 表示，UI 不追加百分号。
- 运行中数量优先通过 ps -o stat 获取状态；保留 ps aux 回退，继续按表头定位 STAT，识别 R+、Rs 等状态。
- 不声称 BusyBox 返回列表按 CPU 排序，也不把不存在的 CPU/内存数据填为零。procps 的原有解析路径保留。

## 运行证据

隔离运行 ID：e6d7e16b-27c0-4221-b111-98fbda410265。

本地记录：.cache/metrics-linux-result.json（采样、每条固定命令状态和批次记录）；.cache/metrics-linux-tests.log。

修复后观察样本：CPU 52%、2 核；内存 19%；ext4 根盘 4%；eth0 UP，收发累计值及速率有效；进程总数 97、运行中 1、列表 10 行；系统及内核非空。数值是瞬时观察，不是固定性能指标。

新增 linux-collection.test.ts 仅在显式设置 TANDEM_LINUX_MANIFEST 时执行。它通过实际 SSH 验证上述六组数据的有效范围、固定命令全部完成，以及暂停后拒绝继续采样且没有新增批次。无环境时跳过，不能把跳过算真实 Linux 通过。

验证命令（app 目录，TANDEM_TEST_BASH 指向项目 Git Bash，TANDEM_LINUX_MANIFEST 指向本轮隔离 connection.json）：

- vitest run src/backend/tests/hosts/metrics --maxWorkers=2：20 文件、151 项全部通过，包括实际 Linux 测试。
- tsc -b：通过。
- 本轮修改文件 ESLint：通过。

测试完成后关闭该虚拟机；正常关机等待超时，清理工具记录 forced=true。该清理结果不作为 Linux 正常关机通过证据。

## 剩余范围

这次覆盖 Alpine 上六类基础采样，尚未完成多发行版、多挂载点、负载变化趋势、断线重连和历史聚合的整组验收；也不是最新桌面包的视觉验收。F13/B12 继续保留未完全验证状态。

遵照用户要求，仅修改本地功能与验证记录，没有提交、推送、打标签或触发 Actions。
