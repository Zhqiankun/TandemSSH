# 会话、操作与事件契约

状态：v0.2 候选契约。以下为逻辑 API，不表示已经实现 HTTP 服务。底座确定后，需将本契约映射到实际实现并冻结字段。

## 1. 统一上下文

本地 UI 通过可信 IPC 进入；外部 MCP 客户端通过已配对的本机通道进入。首版是单 OS 用户、单工作区，不实现组织或多租户服务。

```ts
type Actor = { kind: 'human' | 'agent' | 'mcp'; id: string }
type SessionRef = { sessionId: string; generation: number }
type Controller =
  | { kind: 'human'; id: string }
  | { kind: 'automation'; ownerType: 'agent-task' | 'workflow-run' | 'mcp-client'; ownerId: string }
type OperationContext = SessionRef & {
  requestId: string
  controlEpoch: number
  actor: Actor
  origin: 'manual-terminal' | 'command-panel' | 'workflow' | 'agent' | 'mcp'
  taskId?: string
  workflowRunId?: string
  stepId?: string
}
```

actor 和 origin 由可信通道注入，不采信页面或模型提供的身份字段。MCP 参数不开放 human 身份。人点击运行的流程仍以 workflow 入口检查命令规则，不因为发起人是 human 而跳过。所有资源查询都检查工作区归属和客户端范围，未知资源与无权资源不暴露敏感差异。

SessionRef 标识受控协作上下文，可以是 terminal 或不带 PTY 的 files 工作区；活跃 SSH 认证连接是其下层共享资源。文件管理不要求先打开终端。原始输入/中断只接受 terminal 类型，不能把上游互不兼容的 terminal-sessionId/file-sessionId 直接混用。

## 2. 状态定义

| 对象 | 状态 |
| --- | --- |
| Connection | disconnected、connecting、awaiting-host-trust、authenticating、connected、failed |
| Session | opening、ready、reconnecting、closed、failed |
| 控制者 | human 或绑定到一个任务/流程/MCP 客户端的 automation；不会同时存在两个写入者 |
| AgentTask | idle、planning、awaiting-approval、running、paused-human、paused-policy、paused-budget、needs-reconcile、completed、failed、cancelled |
| Operation | proposed、awaiting-approval、queued、dispatched、running、succeeded、failed、cancelled-before-send、unknown |
| WorkflowRun | pending、running、awaiting-approval、paused-human、paused-policy、needs-reconcile、succeeded、failed、cancelled |

Operation dispatched 表示已交给 SSH 通道，不表示远端已经执行成功。unknown 表示无法确认是否完成或生效，不能自动转换为 failed 后重试。

## 3. 控制权不变量

1. 每个活跃 Session 只有一个写入权威控制器，控制请求和输入派发在其中串行化。
2. 人工接管是高优先级控制事件，不依赖模型返回、不等待 AI 自行让出。
3. 接管生效时 controlEpoch 加一，撤销旧写权限、丢弃未发送的 AI/MCP/流程队列、使旧审批失效。
4. 每次发送字节前再次校验 generation、epoch、主体和策略；只在请求入队时检查不够。
5. 接管响应返回后，旧 epoch 不得再出现新的 remote.write 调用。
6. 已经发出的字节、在途命令和文件传输不能被“撤回”；必须另行中断或核实。
7. 切换 UI 标签不改变任务绑定的目标；重连不沿用旧 generation。

## 4. 会话入口

```ts
openSession({ connectionId, kind: 'terminal' | 'files', terminal?: { cols, rows } })
  -> { sessionId, kind, generation, state, controlEpoch, controller }

takeControl({ sessionId, expectedGeneration, requestId })
  -> { controller: { kind: 'human', id }, controlEpoch, appliedAtSeq, inFlightOperationIds }

grantControl({ sessionId, generation, expectedEpoch, ownerType, ownerId, taskGrantId })
  -> { controller: { kind: 'automation', ownerType, ownerId }, controlEpoch, contextCursor }

sendHumanInput({ sessionId, generation, controlEpoch, inputId, data })
  -> { inputId, disposition: 'accepted' | 'duplicate', appliedAtSeq }

resizeSession({ sessionId, generation, cols, rows })
closeSession({ sessionId, generation })
```

takeControl 仅可信人工入口可调用。grantControl 需要人工授权，不能通过 AI 工具自我批准。sendHumanInput 的 accepted 仅代表核心接受输入；发送和输出另有事件。

人工输入可包含按键、粘贴或控制字符，不把每次按键伪装成一条 Shell 命令。秘密输入使用专用入口和引用，不将原文写入审计/MCP/模型上下文。

## 5. 动作网关

```ts
type Action =
  | { type: 'terminal.command'; program: string; args: string[]; cwd: string; timeoutMs: number }
  | { type: 'terminal.script'; script: string; shell: 'posix'; cwd: string; timeoutMs: number }
  | { type: 'terminal.interactive-input'; data: string; processContextId: string }
  | { type: 'terminal.interrupt'; signal: 'ctrl-c' }
  | { type: 'sftp.upload'; localPath: string; remotePath: string; overwrite: boolean }
  | { type: 'sftp.download'; remotePath: string; localPath: string; overwrite: boolean }
  | { type: 'sftp.write-text'; remotePath: string; contentRef: string; expectedDigest?: string }

proposeOperation(context, action)
  -> { operationId, actionPreview, decision, matchedRules, policyRevision, approvalRequired }

approveOperation({ operationId, approvalChallenge, scope: 'once' | 'task-scope', grantPreviewId? })
  -> { approvalId, expiresAt }

previewTaskGrant({ taskId, sessionId, allowedActions, targets, pathScopes, limits, expiresAt })
  -> { grantPreviewId, scopePreview, deniedScopes, policyRevision }

approveTaskGrant({ grantPreviewId, approvalChallenge })
  -> { taskGrantId, generation, controlEpoch, policyRevision, expiresAt }

dispatchOperation({ operationId, approvalId? })
  -> { operationId, status, eventCursor }

getOperation({ operationId })
  -> { status, exitCode: number | null, outputCursor, resultConfidence }
```

propose/approve 不产生远端副作用。审批挑战由核心绑定动作快照、主体、目标、cwd、generation、epoch、策略 revision 和期限。调用方不能只换 command 字符串继续使用同一批准。

任务范围预授权已获用户确认。`approveOperation` 的 `task-scope` 必须提供 `grantPreviewId`，引用人工确认过的任务范围预览，不能将单条命令批准隐式扩大为整台服务器权限。`approveTaskGrant` 仅可信人工入口可调用；自动模式每次派发核对动作是否被当前 taskGrant 完整覆盖，并重新执行 deny 优先的策略判断。协同模式仍逐步确认。接管、重连、策略变更、到期、预算耗尽和任务结束均使旧 taskGrant 失效，交还 AI 不自动恢复它。

terminal.interactive-input 不作为通用原始写入后门开放给 MCP。只在用户明确批准的交互程序上下文、当前控制权和策略下可用；无法确认上下文时暂停。密码/验证码由人工专用输入处理。

terminal.command 的 program/args 经过确定性的远端 Shell 参数编码。SSH exec 协议接收字符串，因此结构化参数不等于操作系统 execve；编码与 cwd 包装必须测试并展示最终命令。

## 6. 策略试算与配置

```ts
evaluatePolicy({ target, actor, action, proposedPolicyRevision? })
  -> { outcome: 'allow' | 'confirm' | 'deny' | 'unknown', matchedRules, reasons }

savePolicySet({ policySetId, expectedRevision, changes })
  -> { revision, affectedScopes, invalidatedApprovals }
```

保存使用乐观并发检查，版本冲突不覆盖。用户可以预览尚未生效的规则，但真正执行永远使用服务端当前有效规则。策略更改导致审批失效，队列进入重新评估。

## 7. 命令流程入口

```ts
previewWorkflow({ definitionId, version, connectionId, parameters })
  -> { previewId, steps, decisions, warnings }

startWorkflow({ previewId, sessionId, generation, taskGrantId })
  -> { workflowRunId, status, eventCursor }

pauseWorkflow({ workflowRunId })
resumeWorkflow({ workflowRunId, expectedRevision, resumeDecision })
cancelWorkflow({ workflowRunId })
```

preview 不执行命令；start 冻结定义快照和参数。真正执行前仍逐步检查策略、控制权和上下文。resumeDecision 明确指定“从下一步继续”“重试这一失败步”或“人工核实后标记结果”；不存在无条件自动重跑整个流程。

用户直接运行流程时，为 workflow-run 取得自动化控制权，人工原始输入必须先接管。AI 调用已授权流程时，流程沿用父任务控制租约，父任务等待流程结束，不能同时派发流程外命令。完成后也不复用已失效的 epoch 或批准。

完整流程格式和失败语义见[命令流程](08-workflows.md)。

## 8. 事件格式

```ts
type SessionEvent = {
  schemaVersion: 1
  eventId: string
  sessionId: string
  generation: number
  seq: number
  occurredAt: string
  actor: Actor | { kind: 'system'; id: string }
  type: string
  operationId?: string
  workflowRunId?: string
  payload: unknown
}
```

首版事件：session.opened/closed/reconnecting、control.changed、terminal.input.accepted、terminal.output、operation.proposed/dispatched/completed/unknown、policy.denied/changed、approval.requested/expired、workflow.step.changed、transfer.progress、context.gap。

seq 在同一 generation 内单调递增。订阅使用 afterSeq，客户端去重并检测缺口。事件保留超出窗口时返回 GAP，提供可用快照范围；AI 暂停需要完整上下文的动作。

运行时 terminal.output 可承载 base64 编码字节，保留 UTF-8 多字节跨块边界；模型投影和持久化日志不直接复用原始 payload。

## 9. 命令结束与重试

- 优先通过可验证的命令边界、退出状态获取结果；提示符恢复、短时间无输出都不是完成证明。
- 对交互式程序或无法确定的 Shell 状态，exitCode 为 null，展示交互中/未知。
- 自动命令要求已识别为可控制的 Shell 状态；无法识别时让用户恢复提示符或新开会话。
- requestId 在同一主体与操作范围内幂等；重复请求返回原 operationId，不重新发送。
- 崩溃可能发生在“远端已接收、本地未记结果”之间，因此不承诺 exactly-once。
- 审计记入执行意图后再派发；恢复时在途动作进入 needs-reconcile，非幂等动作不自动重试。
- 文件覆盖使用读前摘要/修改信息作为前置条件；这只能检测常见并发变化，不代替服务器端原子权限与事务。

## 10. MCP 首版工具

| 工具 | 限制 |
| --- | --- |
| servers.list | 只列出客户端授权的连接，不返回凭据 |
| sessions.list / sessions.read | 只读授权会话，输出经过上下文和敏感内容策略 |
| commands.propose / operations.status | 经统一动作网关，客户端不能自行批准 |
| files.list / transfers.start / transfers.status | 独立路径范围和写入权限 |
| workflows.list / workflows.preview / workflows.start | 引用已保存的流程版本，不允许模型静默修改定义 |

外部客户端与内置 AI 共用控制权，同一会话不能同时写入。MCP stdio 不等于无限信任：首次配对、客户端身份、权限撤销和命令审批仍需实现。

## 11. 错误与恢复

| 错误 | 含义 | 恢复动作 |
| --- | --- | --- |
| HOST_KEY_CHANGED | 服务器身份变化 | 人工核实指纹 |
| AUTH_FAILED | SSH 认证失败 | 人工更新认证，不反复自动尝试 |
| STALE_SESSION / STALE_CONTROL | generation 或 epoch 失效 | 刷新会话，重新授权 |
| CONTROL_BUSY | 其他主体占有输入权 | 请求人工处理或等待 |
| POLICY_DENIED | 明确拒绝 | 展示规则；AI 不能自动修改策略 |
| APPROVAL_REQUIRED / EXPIRED | 缺少有效批准 | 展示当前动作快照 |
| CONTEXT_GAP | 输出或人工记录缺失 | 人工确认或重新检查环境 |
| EXECUTION_UNKNOWN | 操作是否生效未知 | 核实结果，禁止盲目重放 |
| SECRET_STORE_UNAVAILABLE | 系统凭据库不可用 | 不落明文，提供仅本次使用 |
| MODEL_CAPABILITY_MISSING | 模型不支持所需工具协议 | 停止 Agent，保留人工模式 |
| BUDGET_EXCEEDED | 达到执行上限 | 暂停，用户明确增加预算 |

响应不返回原始堆栈、密码、Key 或完整连接配置。诊断日志保留关联 ID 和脱敏原因。

## 12. 完整基础功能的接口范围

文件工作区使用同一操作上下文和网关；除自动化授权外，还要检查路径与文件提交基线。人工点保存也不是直接调用裸 SFTP 的例外。

| 用例 | 必要输入/输出 | 特殊要求 |
| --- | --- | --- |
| files.list / stat | SessionRef、路径、分页/筛选 → 条目、属性、链接信息 | 不返回未授权路径内容 |
| files.create / mkdir | 目标路径、预览内容/元数据 → operationId | 禁止默认覆盖 |
| files.copy / move / rename | 源、目标、冲突策略 → 逐项结果 | 同步检查两端范围；目录操作部分失败可见 |
| files.remove | 明确目标、递归标志、预览引用 → 逐项结果 | 永久删除与回收站分开 |
| files.setAttributes | 当前属性、新属性、递归范围 → operationId | 不自动 sudo 或扩大权限 |
| editor.open | SessionRef、路径 → documentId、基线引用、编码/换行、内容引用 | 超大/二进制文件能力检测 |
| editor.previewSave | documentId、草稿 revision → 差异、目标预条件、策略结果 | 不产生远端写入 |
| editor.save | 预览引用、批准 → 新基线或冲突结果 | 发现外部变化不静默覆盖；失败保留草稿 |
| transfers.start / list / status | 传输清单与范围 → transferId、进度、状态 | 单文件/批量/递归目录统一结果 |
| transfers.pause / resume / cancel / retry | transferId、检查点/预条件 → 新状态 | 重连需重新检查身份和文件版本 |
| tunnels.create / start / stop | 转发类型、连接、监听/目标范围 → 状态 | 独立授权，不借终端权限自动开端口 |
| metrics.subscribe / unsubscribe | 连接、已授权指标、采样间隔 → 样本流 | 独立只读通道，采集动作可查看 |

补充错误：FILE_CONFLICT、ENCODING_LOSS、TRANSFER_SOURCE_CHANGED、TRANSFER_TARGET_CHANGED、DISK_FULL、PERMISSION_DENIED、UNSUPPORTED_CAPABILITY、PORT_IN_USE。错误必须对应具体文件/步骤，不能只返回笼统失败。

文件事件增加 document.dirty/saved/conflict、transfer.paused/resumed/partial；隧道和采样事件包含连接 ID、主体和范围。原始文件正文不默认落入审计；实际读写结果按[文件工作台](09-base-features.md)验证。
