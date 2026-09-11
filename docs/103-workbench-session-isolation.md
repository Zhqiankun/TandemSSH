# 多会话工作台异步隔离修复

2026-09-12，核对 A03（切标签时 AI 派发仍绑定原会话）时发现界面状态存在独立风险。

## 复现与修复

useTaskWorkbench 在 sessionId 改变后复用同一 alive ref。旧 run 成功返回会插入旧任务并调用旧 refresh，导致新会话 B 的任务快照回退到 A；旧接管的 takingOver ref 还会阻止 B 发起接管。新增两项测试修复前均失败，分别收到 A 快照和缺少 B 接管调用。

修复限定于工作台状态 hook：每个会话生命周期递增代次，run/archive/takeover 捕获代次；只有当前会话请求可以刷新快照、更新错误、解除忙碌和接管锁。切换时重置快照及界面状态。迟到 run 返回 undefined、archive 返回 false，避免 TaskPanel 的调用方将新标签选中项改为旧任务。后台既有操作没有被取消或改派到当前标签。

文件责任：use-task-workbench.ts 管理会话对应的异步界面状态；API 与服务端任务绑定不变。未新增共享抽象或跨层依赖，未改数据库。清理时 alive=false 拦截卸载响应，下一轮 effect 建立新代次，兼容同一会话 ID 再次进入。

## 实际验证

- 新跨会话测试 3 项：迟到操作不刷新 A / 不污染 B、不返回可触发选中的旧结果；B 可以独立接管且 A 完成不解锁 B；旧归档不触发 B 的成功回调。
- TaskPanel、workbench-errors 与新测试共 13 项通过，包含中文自动/协作授权和逐项批准。.cache/workbench-session-results.json。
- 去除冗余清理计数后，两个 hook 测试文件 4 项再次通过；ESLint 无警告；npm run type-check 通过。

本轮为 React hook/面板测试，未证明所有桌面标签切换路径或服务端两会话并发派发。A03 仍保留未完成，后续需继续实际多标签验收。公开 alpha.4 包不含此修复。
