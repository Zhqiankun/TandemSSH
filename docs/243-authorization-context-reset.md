# 授权表单随策略与连接边界重置

## 问题与复现

中文任务面板原本使用任务 ID、控制权 epoch、任务状态、计划修订作为授权表单的 React key，却未包含策略版本与连接 generation。

用户勾选“终端位于命令提示符”等确认后，轮询快照若更新策略版本或连接代次但其余 key 字段不变，旧表单仍保留确认；提交时读取的却是新 props 中的版本。后端仍执行策略校验，本记录不声称已发生越权，只确认旧人工确认被复用于新上下文的界面缺陷。

修复前两项中文面板测试均失败：模拟快照中策略 revision 变化或连接 generation 变化后，复选框持续为 true。

## 修改边界

TaskPanel.tsx 负责页面编排，沿用现有 key 重置机制，加入实际传给授权表单的策略 revision 以及 task.control.generation。边界变化时重新初始化授权表单的人工确认及输入，不在 effect 中异步清空，避免新上下文与旧确认并存的一次渲染。

没有新增模块、共享抽象、API 或后端依赖；同一版本轮询不会改变 key。既有任务 ID、epoch、状态、计划修订重置保持不变。

## 验证

TaskPanel.test.tsx 新增策略版本与连接代次两项复现：初始勾选有效，刷新后确认清除、授权按钮禁用、API 未收到授权且命令写入为空。

vitest run src/ui/tests/collaboration/TaskPanel.test.tsx src/ui/tests/collaboration/task-recovery.test.tsx：2 文件、23 项通过。TypeScript 与修改文件 ESLint 通过；git diff --check 通过。

测试运行中文 jsdom 面板并连接既有生产 TaskRuntime 夹具，但快照边界更新为受控数据，不等同于真实 SSH 断线重连或桌面视觉验收。最新桌面与真实终端组合仍需继续。

本轮仅保留本地改动，未提交、推送或触发 Actions。
