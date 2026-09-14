# 派发前接管的双模式竞态矩阵

2026-09-14。本轮扩展 A05 服务端确定性验证，未修改生产代码。

## 边界与断言

在 OperationGateway 公开接口及真实 SessionControl 上，对 automatic / collaborative 各覆盖三个接管点：异步命令准备尚未返回、operation.intent 审计等待尚未结束、beforeSend 回调即将进入同步 commitWrite。协作模式先批准两个不可变操作，确保拒绝源于接管而非缺少批准。

每次先派发首操作并排入第二操作。接管后两者均为 cancelled-before-send，均无 startedAt，传输写入为空；仅首操作进入准备，已准备资源被释放。完成审计中的 ID / 状态与返回事实一致。对两操作重复 dispatch 保持原结果且没有写入。最后人工输入成功，控制权保持 human。

beforeSend 场景是测试适配器的同步接管钩子，验证最终租约检查；不是声称操作系统会在任意一条 JavaScript 指令间派发 UI 事件。生产传输预检仍遵守无副作用约定。

## 验证与限制

gateway.test.ts 共 142 项通过，包括本轮新增 6 项。日志 .cache/takeover-boundaries-final.log。

首次 4 项失败只发生在“dispose 必须恰好调用一次”的测试假设：接管订阅主动清理，finally 再次收尾；真实 PTY 适配器 cleanup/settled 允许重复释放。修正为资源确已释放的断言，命令零写入、准备次数、审计状态及去重断言均保留。初次日志 .cache/takeover-boundaries-tests.log 保留。

本轮只改变测试文件，不新增业务模块、共享抽象或依赖方向。A05 继续 not-fully-verified：106 的中文组件证据与本轮服务端竞态不代替完整真实远端派发时点及界面联动。整体仍为 59/79。未推送 Git 或触发 Actions。

最终 tsc -b 与修改文件 ESLint 均通过，命令链 exit0；日志 .cache/takeover-boundaries-types.log、takeover-boundaries-lint.log。
