# AI/MCP 上传与下载工具

状态：工具已接入生产入口，打包和实际桌面验证已通过，完整项目仍在实施。MCP 由 24 项增加到 29 项；本轮接入独立文件传输工具，不把保存流程的文件步骤或自动整目录传输算作已完成。

## 工具与行为

| 工具 | 用途 |
| --- | --- |
| list_authorized_files | 返回本任务已授权的来源/目标 ID、版本、名称、大小和状态，不返回本地绝对路径 |
| upload_file | 把已选来源上传到本任务获准的远端路径 |
| download_file | 把获准远端文件下载到已选的精确本地目标 |
| get_transfer_status | 返回操作状态、确认字节数及已有结果，接管后仍可核对 |
| release_transfer | 释放已结束且无待清理事项的进度记录，保留操作结果，不删除文件 |

上传/下载参数包括 path、localGrantId、localVersion、可选 overwrite 和 timeoutMs；MCP 另带 taskId、requestId。输入不接受 localPath、人工身份、审批凭据或选择票据。名称属于不可信数据，不能作为扩大权限的指令。覆盖同时受本地授权和任务/远端规则限制。

创建任务后，用户在桌面选择本地来源/目标，并确认任务的远端文件范围。自动模式可在范围内连续执行；协同模式逐条审批。提交后先用进度/操作查询等待真实完成，再执行依赖传输结果的命令。未知结果不能自动重试或释放。

## 责任与依赖

files/transfer-schema.ts 拥有共享严格参数；collaboration/files/transfers.ts 拥有任务身份检查、提交、进度投影和记录释放；MCP contracts/core/server 只适配协议；AI transfer-tools/runner 只适配模型参数并等待操作结果。实际文件 I/O 继续由 AutomatedTransfers、既有分块服务及本地授权能力完成。

fileObservationContext 只提供已核对主体的观察上下文，不恢复执行租约。它校验 MCP 的原任务、配对客户端、活动连接和服务器范围；提交新动作继续通过 fileContext 和本地授权检查。去重查询只用于返回已存在请求，由 TaskRuntime 对不可变动作进行比较，不重新传输已成功的下载目标。

进度在尚未准备或已释放时可以为空，最终操作结果仍可查询。结束状态以任务操作记录为准；不能把内部进度阶段覆盖为成功。释放需要操作确实结束且无未知/待清理结果。AI 的自动记录释放失败单独报告，不将实际成功的传输改写成“未执行”。

内置 AI 在每次文件传输后结束当前预先生成的工具序列，把结果交回模型重新决策，防止同一响应里的后续命令按假定成功继续运行。人工审批卡从任务的人工授权接口关联实际本地来源/目标；没有匹配 ID/版本的有效授权时不能批准该传输。

## 验证计划与当前边界

测试使用真实回环 SSH/SFTP、真实本地文件、任务本地授权存储、标准 MCP SDK 和可控模型夹具，验证自动/协同上传→命令→下载、字节校验、去重、接管后只读进度、客户端连接变化、原始路径拒绝和模型等待结果。核心测试中的命令执行器是确定性替身；真实桌面另行验证共享 SSH Shell，不混为同一种证据。

打包检查需要在构建完成后运行，避免 stdio 文件被构建清理而跳过。真实 Codex 发现仅使用临时配置，不创建 Codex 任务、不修改日常配置、不调用付费模型。系统凭据配对只用于测试生成的身份，验证后撤销。

保存流程中的上传/下载步骤、自动目录批次、单传输暂停/恢复及跨重启恢复仍需后续接入；现有任务取消/人工接管可中断传输。历史草稿、凭据统一、认证/跳板/监控/隧道、真实跨版本升级、Linux/压力/许可和全套验收目标不变。


## 本轮实际证据

- 最终联合回归 **69 文件 / 477 项通过**，无跳过，日志 .cache/transfer-tools-regression-final.log；覆盖现有 AI/MCP、任务/文件/原生能力，以及自动和协同新工具。初轮旧工具数量与断开状态断言已按真实行为修正；MCP 断开会取消相应任务，不能借断开保留执行权限。
- 实际打包入口的 stdio + 系统凭据 + 签名管道检查 **2 文件 / 3 项通过**，.cache/transfer-tools-packaged-codex.log；包含两种模式的真实本地/SFTP 文件往返。
- 本机 Codex app-server 实际发现 **29 项工具**及新增五项中文标题，.cache/codex-mcp-integration.json。使用临时配置，未创建 Codex 任务、未修改日常配置、未调用付费模型。
- 真实桌面通过正式主机/配对接口、原生本地授权和 MCP stdio，在 automatic 与 collaborative 两种模式完成上传→真实 SSH Shell 的 pwd→下载。两端字节一致，上传/下载整体 SHA-256 校验通过，传输期间 SSH 认证连接数不增加；协同操作从实际界面逐条批准。

桌面证据目录 .cache/desktop-observation-report-0f91a94a-595e-4296-b7f0-381bfe8d76cc，包含 transfer-tools-result.json、transfer-upload-review.png、transfer-download-review.png、transfer-tools-completed.png 和 fixture-pty-input.jsonl。审批前检查实际操作卡 DOM 已关联本地来源/目标。任务范围通过已认证人工 API 授予；原生选择器由测试主进程提供专用测试路径，并非人工操作系统对话框。测试配对已撤销，桌面及 SSH/PTY 夹具正常退出（.cache/transfer-tools-desktop-observer.log）。

测试准备曾因直接调用主机 API 后未失效前端缓存，导致新主机无法打开；改用正式 hosts:refresh 事件后通过。另一次 Windows 回环 ConPTY Shell 探测显示 command 首字母缺失、观察请求超时；未绕过探测或当作传输成功。之后加入测试 SSH 输入记录，确认发送/收到完整命令并完成两种模式。该次探测异常的根因尚未完全确定，保留失败目录 .cache/desktop-observation-report-86608b62-2c3b-49d8-a2ad-ef59bb1ad142，继续纳入 Windows/真实 Linux 稳定性矩阵；不以一次重测代替全面稳定性结论。

完整类型、改动模块 lint 和中文键检查通过；前后端构建及本地解包验证包通过，日志 .cache/transfer-tools-types-final.log、.cache/transfer-tools-lint-final.log、.cache/transfer-tools-build.log、.cache/transfer-tools-package.log。构建保留既有大资源块提示，本地验证包复用原生模块，标准 Windows 原生编译继续由 CI 验证。
