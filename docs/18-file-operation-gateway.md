# 文件动作网关与路径授权

后续状态：正式 AI/MCP 文件工具已接入，MCP 现有 22 项工具，见[第 19 份文档](19-ai-mcp-files.md)。下文保留 2026-09-07 网关阶段的实施记录，其中“尚未接入”描述当时状态。

更新日期：2026-09-07。当前完成统一操作网关和任务运行器的文件执行边界、文件路径策略及中文配置。真实 SFTP 的自动/协同用例已经通过专项测试。**正式内置 AI/MCP 文件工具仍在接入；当前 MCP 工具目录仍是此前的 18 项，不包含文件工具。**

## 1. 本轮实现

OperationGateway 现在区分 terminal.command、file.read 和 file.write。文件操作与命令使用同一实例的串行队列、任务控制租约、策略修订、审批与执行记录。SFTP 操作通过 FileExecutorPort 执行，不包装成伪命令，不向 PTY 发送空字节或伪造退出码。

任务运行器提供 submitFile 入口，复用已有任务的主体校验、MCP 连接绑定、操作次数、状态、完成条件和人工接管。文件和命令不得相互插队；已运行的文件动作结束后，排在后面的命令才能发送。文件操作失败或未知会按任务状态机暂停，不能把缺少终端退出码认定为成功或失败。

同一 requestId 的相同动作只执行一次，变化的路径、版本或内容摘要会导致请求冲突。未知结果保持未知，不因迟到的成功回调变成确定成功。文件超时撤销原租约，并阻止后续文件 I/O，不向人工终端发送 Ctrl+C。

## 2. 独立文件授权

新增 FileScope：path、kind（精确路径或目录及子路径）、access（读、写或读写）。TaskAuthorization.fileScopes 默认为空，命令授权不隐含文件权限。即使逐次确认文件动作，也必须在本次任务文件范围内。

路径使用 POSIX 规范化后按目录边界匹配，不把 /srv-extra 当成 /srv 子目录。请求路径和解析后的目标都要通过范围检查。文件写操作的规范目标绑定审阅时的目标；执行期间变化则停止。读操作在解析目标后再次检查规则和授权，不能借符号链接读取范围外正文。

CommandPolicySet 增加独立的 fileRules 和 strictFileAllowlist，沿用原有全局、分组、主机和任务作用域。文件规则的 deny 优先；存在允许项或严格文件白名单时，该规则集必须覆盖请求路径和真实目标。原命令规则保持原语义，不用命令正则推断 SFTP 权限。

中文任务面板已提供文件范围编辑，策略窗口已提供文件路径规则与严格白名单。现有试算区域明确标为“命令规则试算”；文件路径试算的产品入口仍待补齐。规则保存继续使用版本校验并撤销旧授权。

## 3. 执行器契约

FileExecutorPort.prepare 只准备执行，不读取或改写远端文件，也不另建 SSH 认证连接。execute 收到网关的 guard：解析目标后、每次后续读写及最终提交前必须调用，并同步发起对应 SFTP 请求，不能在检查后另排不受控异步队列。

每次检查同时核对会话 generation、控制权 epoch、任务主体、截止时间、主机状态、规则和文件范围。任务授权剩余次数在开始执行时扣除一次；后续分块检查不会反复扣次数，也不能以已扣次数为理由跳过撤权检查。

生产文件执行器尚未绑定到 TaskSession.files。未配置该端口的会话明确返回 FILE_EXECUTOR_UNAVAILABLE，不降级到独立 SSH、Shell cat/echo 或旧文件覆盖接口。

## 4. 正文与结果边界

file.write 动作只含路径、规范目标、版本、提案 ID、内容摘要、字节数和编码格式。正文不进入动作定义、任务摘要或策略数据。后续生产适配必须把提案 ID 绑定到文件模块持有的不可变正文与打开基线，实际执行前核对摘要；模型不能只报一个摘要就直接写入。

FileExecutionResult 使用 succeeded/failed/unknown，返回限定的文档元数据、字节数、临时路径和提交不确定标记。严格结果 schema 拒绝混入正文的额外字段，也拒绝同时声明成功与错误/不确定提交。意外文件异常不会直接把任意错误消息写入操作记录。任务面板展示文件动作、真实目标、处理字节数和待核对提示；不伪造终端退出码。

完整正文缓存、模型可读的脱敏内容、不可变写入提案及人工差异审阅，是正式 AI/MCP 文件工具开放前需要完成的配套，不把本轮元数据接口当成完整文件编辑工具。

## 5. 文件责任与依赖

| 文件/目录 | 责任 |
| --- | --- |
| app/src/types/file-operations.ts | 文件动作、范围、规则和限定结果 DTO |
| app/src/backend/collaboration/policies/file-policy.ts | 文件参数校验、POSIX 路径匹配与多级拒绝优先策略 |
| app/src/backend/collaboration/policies/schema.ts | 持久化命令与文件规则的统一版本化配置校验 |
| app/src/backend/collaboration/operations/gateway.ts | 同一队列、租约、授权、审批、超时和执行记录 |
| app/src/backend/collaboration/operations/file-result.ts | 只允许文件元数据进入操作结果，拒绝正文和矛盾状态 |
| app/src/backend/collaboration/tasks/runtime.ts | 任务主体、MCP 连接身份、共享预算与文件/命令状态编排 |
| app/src/ui/features/collaboration/FileScopes.tsx | 文件授权与文件规则共用的明确路径字段；归属协作功能，不放入通用 UI |
| app/src/ui/features/collaboration/TaskPanel.tsx | 人工授权、文件动作与结果的中文呈现 |
| app/src/ui/features/collaboration/PolicySettings.tsx | 当前作用域的文件规则编辑，复用已有保存和撤权流程 |

核心通过 FileExecutorPort 调用文件适配器，不依赖页面或文件 HTTP 路由。文件正文仍归文件模块所有，公共操作类型保持无正文。没有新增无业务归属的 common/utils 目录。

## 6. 验证与当前限制

联合回归 **50 文件 / 384 项通过**（.cache/file-gateway-regression.log），覆盖现有 AI、MCP stdio、会话接管、流程、文件编辑及中文界面。随后修正文件超时原因被接管状态掩盖的问题，并增加矛盾结果断言，相关最终回归 **4 文件 / 60 项通过**（.cache/file-gateway-final-contract-tests.log）。专项日志另见 .cache/file-gateway-protocol-tests.log、.cache/file-gateway-ui-tests.log、.cache/file-gateway-result-ui.log。网关策略测试涵盖精确路径/目录边界、规范化、链接越界、拒绝优先、没有文件授权、协作逐次批准、共享队列、共享预算、接管阻断下一块、超时、重复请求和正文不进入结果日志。

真实 SFTP 夹具分别用自动和协同模式读取中文及字面 %2F 路径，再通过同一网关和 DocumentService 保存新文件，校验磁盘原始字节与编码一致，终端写入为零。另有 MCP 主体的真实 TaskRuntime 测试，确认文件和命令共用预算；这是任务层验证，**不是已经通过 stdio 新增了 MCP 文件工具**。

中文界面测试验证路径授权内容、文件规则保存且原命令规则保留、字节数与无伪造退出码。一次测试错误地创建了没有 Agent 计划的 assistant 任务，界面按已有规则禁止授权；改用已连接 MCP 主体后通过，未削弱真实 Agent 的计划确认要求。

最终类型检查、相关模块 lint 与前后端构建通过，日志为 .cache/file-gateway-types.log、.cache/file-gateway-lint-final.log 和 .cache/file-gateway-build.log。构建仍提示既有资源块较大；本轮未刷新 win-unpacked 桌面包。测试进程已退出。

复核命令（在 app 目录，配置当前平台所需的测试 Shell）：

```text
npm run type-check
npm test -- src/backend/tests/collaboration src/backend/tests/files src/ui/tests/collaboration
npm run build
```

仍待：正式 SSH 会话的 SFTP 适配、正文/提案存储与审阅、内置 AI/MCP 文件工具、文件规则试算、文件流程步骤和传输动作、新版打包桌面实测。Windows 模拟的所有者元数据和另存验证仍不能替代真实 Linux/OpenSSH 覆盖成功与权限矩阵；完整原有验收范围不变。
