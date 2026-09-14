# 搜索子主机时保留祖先行

2026-09-13，F01/B01，承接 286。

发现 collectVisibleRows 会在子主机命中时保留祖先，但 HostItem 又只检查本机字段并返回 null，导致父主机行被二次过滤。实际行组件测试在子主机名称或备注命中时均复现失败。

将既有 visible-rows 模块的 hostHasMatch 作为公开子树匹配入口，HostItem 与虚拟列表使用同一规则。保留父物理机、中间虚拟机与命中子主机，不引入无关主机，不改写展开偏好。该入口仅属主机树领域，调用方为主机树行计算与行组件；没有新增 common/utils 抽象或反向依赖。

新增测试直接将实际 collectVisibleRows 结果交给真实 HostItem 渲染，覆盖折叠的两级祖先与名称/备注两种命中，不只断言数据数组。修复前 2 项失败；修复后行组件、可见行、树构造、排序共 4 文件 48 项通过。TypeScript、ESLint、diff 检查通过。日志 .cache/host-search-ancestor-before.log / host-search-ancestor-after.log / host-search-ancestor-tsc.log / host-search-ancestor-lint.log。

尚未打包本轮搜索修改，需与 286 一起进行主机管理真实桌面验收；38/79 计数不变。未提交、推送、打标签或触发 Actions。
