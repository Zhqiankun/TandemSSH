# 保存流程中的文件步骤

状态：已接入工作台、内置 AI 和 MCP；完整产品仍在开发。纯命令流程继续支持格式版本 1，含文件步骤的模板使用版本 2。

## 使用方式

1. 在流程库编辑步骤，选择“上传文件”“命令/脚本”或“下载文件”，配置顺序、远端绝对路径和文件位置名称。保存、导入和预览均不执行操作。
2. 预览显示全部步骤和各自规则结果。建立流程任务后，在“本任务的本地文件授权”选择上传来源、下载目标。
3. 在“本次流程的本地文件”中，将位置名称绑定到已选文件；点击“填入剩余步骤的远端文件范围”可加入精确路径，再检查、调整并授权。
4. 自动模式在任务范围内连续执行；协作模式逐条审批。操作卡显示实际本地来源/目标、远端路径、进度和校验结果。
5. 接管后，交还时只要求为剩余步骤提供有效文件绑定。已完成的步骤不重跑；未知或失败步骤仍须人工选择恢复位置。

每个下载步骤使用独立文件位置，不同下载步骤不能绑定同一个目标授权。下载目标一经成功使用即不可再次使用；任务结束、断开、撤销等还会使授权失效。模板不保存本地绝对路径和运行期授权 ID。

## 可导入示例

```json
{
  "schemaVersion": 2,
  "id": "artifact-check",
  "name": "上传并检查产物",
  "version": "1.0.0",
  "parameters": {
    "remote": { "type": "remote-path", "required": true }
  },
  "files": {
    "artifact": { "direction": "upload", "description": "待上传的产物" },
    "result": { "direction": "download", "description": "下载后的核对文件" }
  },
  "defaults": { "cwd": "/srv", "onFailure": "stop" },
  "steps": [
    { "id": "upload", "name": "上传产物", "action": { "type": "upload", "path": { "param": "remote" }, "localFile": "artifact" } },
    { "id": "check", "name": "检查工作目录", "action": { "type": "command", "program": "pwd", "args": [] } },
    { "id": "download", "name": "下载核对", "action": { "type": "download", "path": { "param": "remote" }, "localFile": "result" } }
  ]
}
```

文件路径不继承 Shell 工作目录；文件步骤设置 cwd 会被拒绝。overwrite 默认 false，配置 true 仍需匹配的本地覆盖授权及远端写入范围。文件步骤、命令步骤共用操作次数和有效期，不创建第二套预算。

默认失败停止。明确配置 continue 后，只允许已核实的普通失败继续（文件不存在、权限不足、源/目标版本改变等列明错误）；审计缺口、策略/控制权失效、提交结果未知或仍有临时文件待处理时仍停止。继续后的最终状态保留失败，不能显示为全部成功。

## AI 与 MCP 契约

工具总数保持 29 项。独立流程使用 preview_workflow → start_workflow，随后在桌面绑定本地文件并授权。父任务已存在时，先用 list_authorized_files 获取该任务授权的文件，再预览：

```text
preview_workflow({
  workflowId, sessionId, parentTaskId, parameters,
  fileBindings: {
    artifact: { localGrantId, localVersion },
    result: { localGrantId, localVersion }
  }
})
```

fileBindings 是本次预览和运行的数据，不写入模板导出。没有 parentTaskId 时不能携带绑定；绑定必须属于原任务、原连接和对应传输方向。已授权父任务运行前必须拥有全部文件绑定；待授权父任务可先附加计划，再由桌面补全绑定。附加后仍沿用父任务控制权、范围和剩余预算。

内置 AI 运行流程后等待真实结果，结束预先生成的工具序列，取得新结果再决策。文件位置描述、文件名及流程输出均是不可信数据，不能借此扩大权限。

## 模块责任

| 文件/模块 | 职责与依赖 |
| --- | --- |
| types/task-plan.ts | 命令与文件步骤的判别联合、运行期绑定；不依赖 UI 或 I/O |
| workflows/definition.ts | 格式版本、文件位置与参数校验，编译有序计划 |
| tasks/plan.ts | 运行计划和绑定 schema、文件动作转换、可继续失败判定 |
| workflows/library.ts | 模板保存/导出、完整预览、规则试算、独立与父任务接线 |
| tasks/runtime.ts | 顺序执行、恢复位置、授权及最后执行前检查；通过端口使用本地文件授权和进度服务 |
| policies/file-policy.ts | 无 I/O 的路径规则试算，与实际文件动作共用判断 |
| TaskAuthorizationForm / TaskWorkflowFiles | 中文授权与剩余文件绑定；workflow-file-bindings.ts 只负责界面可选项判定，不能授予执行权限 |
| TaskPlanLine / WorkflowDefinitionEditor / WorkflowFileSlots | 完整步骤展示、模板编辑和文件位置编辑 |
| AI/MCP 适配器 | 严格参数和身份传递，复用任务运行核心 |

commands 保留为纯命令投影；含文件步骤时使用 plan 表达完整顺序。步骤总数、预览决策、幂等指纹和执行索引均以完整计划为准。已结束且无未知/清理事项的传输进度可释放，操作结果仍保留。

## 验证记录

- 联合回归 41 文件 / 306 项通过，覆盖任务、旧流程、AI、MCP 文件工具、中文流程/授权和翻译：.cache/workflow-files-regression.log。
- 文件服务及实际打包 MCP stdio 补充回归 16 文件 / 124 项通过，无跳过：.cache/workflow-files-file-stdio-regression.log。
- 新混合流程与中文界面专项 17 项通过；另含内置 AI 两种模式的保存流程文件往返测试。测试实际创建本地文件，使用回环 SSH/SFTP 校验字节；单元夹具的命令执行器为确定性替身，不能据此宣称真实 SSH Shell 已通过。
- 完整类型检查、改动模块 lint 无错误/警告、中文静态键缺失为 0；前后端构建和本地解包验证包通过。.cache/workflow-files-types-final.log、workflow-files-lint.log、workflow-files-build.log、workflow-files-package.log。本地包复用已验证原生模块，标准原生构建由 CI 单独执行。

桌面验证正在收尾：首轮自动模式完成真实共享 Shell 和文件往返；协作探针过早读取上一条审批状态，现改为按操作 ID 等待完成。复测再次出现既有 Windows ConPTY/Bash 首字母丢失：SSH 输入记录包含完整 command，Shell 显示 ommand，流程停在状态核对。失败证据目录 .cache/desktop-observation-report-a0674bc8-4931-4761-a38a-3199959ae0b3 和 .cache/desktop-observation-report-3b48ef13-888f-494f-820b-a91a0bb654ef。独立焦点输入试验 9 次未复现，不能据此确定根因；当前进一步记录有界 ConPTY 输入、输出和窗口尺寸事件。

剩余完整范围保持不变：自动目录批次、跨重启恢复、加密草稿/备份和凭据统一、完整认证与跳板、监控与隧道、真实跨版本升级、Linux/Windows 稳定性与压力、全界面汉化、许可清单及 A01—A37 最终验收。

### 桌面复测与终端问题定位

第三次桌面探针仍停在首条 Shell 状态探测，未执行后续文件步骤，不记为本轮完整桌面通过。证据目录 .cache/desktop-observation-report-e2b2fee5-edba-4345-b0f0-ddc797573203；conpty-events.jsonl 同时记录 SSH 输入、ConPTY 输出和窗口尺寸。完整 command 已送入 ConPTY，尺寸由 160 列缩到 58 列，ConPTY 返回的 Bash 文本为 ommand。

独立试验增加尺寸变化后，9 次中的 1 次复现相同丢字，发生在焦点事件与缩窄共同出现的场景：.cache/workflow-conpty-resize-repro.json。单独焦点的前 9 次未复现。该结果缩小了调查范围，不证明根因或修复；不能由此排除其他平台、终端实现或交互时序的风险。后续需继续处理 Windows 终端稳定性，并重跑实际桌面两种模式，不能仅凭本轮 430 项测试宣布完整验收。

本轮桌面验证使用独立配置、临时配对、测试本地文件和回环 SSH/SFTP；没有连接用户服务器、调用付费模型或改日常 Codex 配置。失败探针已结束并清理其应用/SSH/PTY 进程及测试配对。文档 JSON 示例已由真实流程编译器核对为上传、命令、下载三步。


## 后续桌面验收

协议异常处理补齐后，使用官方新版便携 Bash 的实际桌面已验证自动与协作两种保存文件流程，损坏探测也正确暂停并归还控制权；旧版 Bash 兼容风险仍保留。模块修复、正负向证据和实际限制见[终端可靠性记录](32-terminal-reliability.md)。
