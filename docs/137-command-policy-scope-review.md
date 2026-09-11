# 命令规则跨入口矩阵与拒绝来源解释

2026-09-12。

继续 R08 原始四级规则范围：全局、服务器组、服务器和任务。新增统一 OperationGateway 矩阵，四种受控来源 agent/workflow/mcp/command-panel × automatic/collaborative 两种模式 × 四种作用范围，共32种组合。每种均已有任务授权，再命中任一层 deny，单次批准与 dispatch 都返回 POLICY_DENIED，实际 SessionControl 写入数组为空。这里验证统一网关，不把 origin 字段夹具冒充真实 Codex/MCP 网络端到端调用；自由人工终端仍按已确认设计不受这些硬规则拦截。

发现 UI 对 POLICY_ALLOWLIST_MISS:<setId> 等原因只显示泛化文本，用户无法判断哪套白名单阻止操作。policy-presentation 保留生成原因携带的规则集来源，PolicyEditor 使用草稿中的作用范围和主机名称解释；找不到已知主机名称时才回退其编号。试算期间字段禁用，编辑草稿清理试算结果。用户自定义原因不因本次新增格式被修改。

三个文件 / 33项回归通过，包括网关、schema、实际 React 策略编辑器。新增界面场景用真实规则求值器试算：prod 分组和 Fixture 主机两套严格空白名单均被解释，显示两个拒绝来源，不保存或执行命令。最后补上主机名称后，PolicySettings 6项再次通过。ESLint及中文缺失键检查通过。

模块责任：规则判定仍在 backend/collaboration/policies，执行权仍在 gateway；前端仅解释既有 decision，不修改优先级或授权。当前证据不覆盖全部规则管理持久化、所有白名单/确认组合和桌面操作矩阵，R08保持未完成。alpha.6公开标签不变。
最终 tsc -b 类型检查通过。
