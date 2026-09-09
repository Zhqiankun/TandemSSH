# 任务中的目录进度恢复

继续原始自动/协作、中文和 MCP 目标。先接通上传目录的条目边界，再接通下载目录及部分传输资源；完整双向恢复不会被本阶段单向结果替代。

TaskRuntime 保存当前目录步骤的检查点，原流程计划与父任务关系仍由既有任务恢复格式管理。DirectoryWorkflowSteps 拥有目录步骤恢复编排；DirectoryTransfers 拥有目录清单与逐项结果；UploadTreeService 继续校验远端目录身份及完成文件的字节/SHA-256 收据。原生上传来源服务拥有本地来源身份快照，仅在用户重新选择目录得到新能力后重绑定，不直接打开检查点中的路径。

目录检查点的 remoteTree 和 nativeSource 分别是其拥有服务的私有数据，任务核心仅保存和传递；远端格式由 uploadTreeCheckpointSchema 校验，原生格式由 upload-source-checkpoint 在原生使用前校验。外部 HTTP/MCP 只提交恢复记录 ID 和新会话，不允许提交这些检查点。核心类型不反向依赖后端实现。

恢复仍创建新任务并等待新授权。重新选择来源、新目录范围和本次任务预算生效后，目录预览操作通过原网关核对原来源与远端结果，再进行新的清单确认。已核验的完成文件及目录不再派发写操作；未完成项使用原清单及选择继续。协作模式依然逐项批准，自动模式不越过硬规则。原预览 ID、授权、操作批准及本地能力不恢复。

当前阶段不把在途部分文件、待清理临时文件或未知提交结果当作完整条目；这些资源仍需专门的传输检查点接入。下载目录必须同时恢复原生目标及完成收据，不能只跳过相同名称的文件，后续单独接入同一目录检查点契约。

主智能体负责实现和验证。允许依赖：任务 UI/MCP → RecoveryService/TaskRuntime → 目录步骤端口 → DirectoryTransfers → 上传树服务及原生目录授权。禁止页面或 MCP 构造可信检查点，禁止恢复旧执行能力，禁止保存流程直接访问原生私有记录。验收以实际 SFTP 文件字节、完成项时间戳、授权前无写入及自动/协作继续结果为准。

## 已实现与文件责任

上传目录流程可在完整条目之间保存为任务检查点。恢复创建新任务，重新选择原目录并授权后，通过新的预览/清单确认核验来源和远端收据，跳过已核验完成项，再执行剩余条目及后续命令。MCP 沿用原客户端身份领取，中文恢复窗口显示“上传目录进度”和已完成/总条目数。未知在途条目仍标记为需要资源恢复，不能直接当作完整条目重试。

新增 `types/directory-step-recovery.ts` 定义任务核心可保存的服务快照信封；`files/directory-step-checkpoint.ts` 校验远端检查点、步骤归属、条目和完成收据。TaskRuntime/恢复 schema 保存并恢复当前步骤状态，同时校验用户、服务器公钥、路径和冻结步骤 ID。原生 `TaskLocalDirectories` 复用已有 UploadSources checkpoint/restore，仅使用用户新选择的能力重绑定。DirectoryTransfers 在网关预览范围内恢复并核验上传树，DirectoryWorkflowSteps 在新确认后只产生剩余条目的动作。没有新增 common/utils 模块或产品级恢复捷径。

原生来源快照包含路径和身份元数据，因此只进入系统加密任务记录；MCP 的保存详情仅投影进度及既有操作信息，不返回 nativeSource。新旧任务、预览和本地授权 ID 分离，旧操作不重新入队。来源被替换、已完成远端文件的校验收据不一致时返回明确失败并停止，没有新条目写入。

## 实际验证

完整应用回归 **460 文件 / 3308 项通过，4 项按既有条件跳过**；独立真实 PTY 组 **1 文件 / 10 项通过**。最后补充在途目录条目必须等待资源恢复的保护后，目录/任务/AI 恢复与中文界面组合 **5 文件 / 50 项通过**。类型、全库 lint、中文键检查、生产构建与 Windows 目录包通过。最终包原生探针验证 13 项依赖；打包 MCP/隔离 Codex 与安装脚本保护组合 **3 文件 / 5 项通过**，其中 MCP/真实 Codex 为 3 项，仍发现 38 项工具，没有发出模型任务。

真实 Windows 最终包在自动和协作模式下分别通过 MCP 启动“上传目录 → SSH 校验”流程。首次授权限制为 4 项操作，停在目录及首个文件完成后；界面显示 **已完成 2 / 3 项**。保存后删除原模板，应用正常退出重启，再由原 MCP 客户端领取，新任务先等待重新选择目录和人工授权。恢复后的新操作只上传第二个文件；首个文件时间戳不变，第二个文件字节一致，真实共享 Shell 的 sha256sum 返回预期摘要。协作模式仍逐条批准，包括新的清单确认。原生目录选择只指向本轮临时测试目录，未连接业务服务器或外部模型。

最终桌面证据：`.cache/desktop-observation-report-96819e15-991e-4670-9dec-5836845a9c6d`。保存窗口截图已核对中文进度、原计划和 MCP 领取/桌面授权提示；最终完成状态及逐场景结论记录于 `restore/directory-recovery-result.json`。4 份实际任务记录均具有 TTR1 加密头，测试名称未出现 UTF-8/UTF-16 明文，见 `.cache/task-directory-recovery-encryption.json`。最初成功的桌面报告 `.cache/desktop-observation-report-c7962ee2-5300-43bf-b7c2-2c89db21a089` 保留；最终报告包含最后的中断保护。

主要日志：`task-directory-recovery-application-tests.log`、`task-directory-recovery-terminal-tests.log`、`task-directory-recovery-final-boundary-tests.log`、`task-directory-recovery-final-types.log`、`task-directory-recovery-lint.log`、`task-directory-recovery-final-build.log`、`task-directory-recovery-final-package.log`、`task-directory-recovery-desktop-final.log`、`task-directory-recovery-native-probe.log`、`task-directory-recovery-final-package-tests.log`，均在 `.cache`。

首次异常测试发现来源/目标变化被保守归类为需人工核对；这些恢复预览只核验、不写文件，现仅将已知来源、目标及收据变化明确归类为失败，其他未知错误仍保留保守处理。修复后 16 项目录组合通过。格式推断产生的类型不匹配已在经过 schema 验证的记录投影处修正，没有放宽运行时格式校验。最后的中断保护确保自动检查点中的未知目录条目仍标记 resourceRecoveryRequired，直到专门的部分传输恢复接入。

## 仍需继续

本阶段完成的是上传目录的条目边界恢复。下载目录的原生目标状态、部分文件检查点、独立 AI/MCP 目录批次协调器，以及内置 AI 父任务目录恢复的专门桌面组合仍需继续；已有命令父流程恢复保持不变。真实 Linux/OpenSSH 权限/断线矩阵、大目录压力、完整认证/跳板、监控/隧道权限、备份和完整 F/B/R/A 验收未完成。真实跨版本安装仍在第 46 阶段修复验收脚本并重跑，不以本轮目录恢复通过替代更新验收。
