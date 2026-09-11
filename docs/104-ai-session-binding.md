# AI 多会话绑定专项验证

2026-09-12，继续 A03 原始验收。

后端新增 session-isolation.test.ts：同一 TaskRuntime/AiTaskCoordinator 内有两个独立 SessionControl、hostId、cwd、写入数组及输出快照。延迟 A 的第二轮模型响应，创建并完成 B，然后释放 A。automatic / collaborative 均验证 B 完成期间 A 只采集上下文，随后 A 命令只写 A；B 写入不变。模型请求 target、终端输出、操作 cwd 和结果始终属于原会话，对方输出/结果不存在。协作模式两边分别批准。

界面 AiTaskComposer 新增延迟提交测试：点击“让 AI 规划”后暂不调用提交函数，切换 sessionId 到 B 再调用，API 仍收到点击时的 A 和原目标。结合 103 的工作台迟到响应隔离，本轮 3 文件 / 8 项通过；.cache/multi-session-ai-results.json。测试文件 ESLint 通过。

源码核对：Terminal.tsx 为 TaskPanel 设置 key={collaborationSessionId}，生产会话变化会重新挂载面板，因此 103 所修 hook 复用问题不能直接解释成所有正常桌面标签切换都能触发；它加强了该 hook 自身的会话契约。本轮没有改生产路由或派发目标，也没有添加共享抽象。

局限：后端 SSH 和模型使用可控端口，React 用例使用 rerender 模拟会话变更。尚未执行实际 Windows 多标签切换与远端副作用联动观察，故 A03 仍不标记 verified。
本轮 npm run type-check 通过；补入最后的界面测试后 tsc -b 增量复核亦通过。
