# 终端录制写入边界

状态：录制写入边界、真实 Windows 故障验收、最终应用回归与打包检查通过。

本轮只处理用户主动开启的完整终端录制；默认脱敏操作审计仍走独立的既有边界，不把两者混为同一种记录。

责任：terminal/recording-writer.ts 维护单个录制的一次在途写入、有界待写数据、超时和结束状态；session-manager 适配文件写入、同步撤销自动租约及合并元数据更新。共享 types 只定义录制失败枚举和既有 terminationReason 字段中的 recording-stopped: 命名空间，供服务端和 UI 一致解释，无数据库迁移。

每个录制的在途加待写事件最多 4 MiB、4096 条，正常按 300 ms 合并写入，同一时刻只启动一项文件写入。超过容量、写入失败或单次写入超过 15 秒时停止接受新录制事件，清除待写项、显示缺口并暂停自动任务；已交给操作系统的单次写入可能稍后完成，不宣称能撤回。手工终端保持可用。输入录制失败同步撤销租约时，必须阻止尚未交给 SSH 的自动输入，不能在撤销后继续写入。

成功写入后才增加已保存字节数；失败状态写入录制元数据，历史列表和查看页显示不完整标记。第一次写入失败时可能没有可用文件，后续写入失败也可能留下不完整尾部，不把文件存在当作完整成功。默认不自动重新开启已中止的录制；重新录制需要新会话。

验证覆盖：慢存储容量、极小事件数量、单一写入、超时后迟到完成、拒绝和未处理 Promise、关闭后拒绝新事件、元数据合并、自动输入撤销竞态、手工操作继续、实际 Windows 写入失败与中文历史标记。范围不替代所有存储故障/长期录制/播放器大文件的完整验证。

实测发现并纳入本轮的原有缺口：主机创建与更新接口遗漏 enableSessionLogging。该接口继续负责录制布尔值校验与数据库映射：新建默认关闭，更新省略字段保留原值，明确 true/false 才修改；不改变权限规则或新增依赖。原生验收将通过实际 API 创建、开关及省略更新后读取验证，再进入录制故障流程。

## 真实 Windows/Linux 验收

使用固定 Alpine 3.24.1 隔离实验机 2c907587-0365-4bdb-874c-49459c7772f6，经需要交互验证的跳板和目标连接真实 Linux Shell。仅目标主机主动开启完整录制。先验证实际主机 API：创建默认关闭/明确开启，更新关闭/开启，省略字段保留两种状态，非法字符串返回 400，最终重新读取仍为开启。

在中文 Windows 应用中通过打包 MCP 建立自动任务，执行 export 和 printenv，确认 .cast 中已有正常输出。只将本次隔离用户目录下的录制文件设为 Windows 只读，再产生终端输出触发实际 appendFile 失败。已验证：

- 任务进入 paused-human；MCP read_terminal 返回 recordingFailure=write-failed。
- 后续自动 touch 被拒绝，独立 SFTP 确认未生成文件；中文终端明确提示录制已停止。
- 历史 API 保存 recording-stopped:write-failed。恢复测试文件属性后，人工直接终端输入仍可创建文件。
- 核对后重新授权，MCP 自动 touch 成功并通过 SFTP 确认；录制文件内容没有随之改变，不静默恢复录制。
- 中文会话记录列表显示“录制不完整”。本次故障前保存的 5322 字节前缀有合法 asciicast v2 头和逐行事件；这不代表所有部分写入故障都能留下可播放尾部。

成功证据：.cache/desktop-observation-report-1b4481d8-a8ac-4ddc-8e6f-f5954dbfd3bd/recording-bounds-result.json；截图 recording-stopped.png、recording-history-incomplete.png；运行日志 .cache/recording-bounds-desktop.log。测试应用正常退出，实验机正常关闭（退出码 0），SSH/QMP 及应用测试端口均已释放。

首次失败证据 1f5e8265-083f-4560-88de-7c9533f2118c：保存主机遗漏录制开关，无法生成录制。修复创建和更新映射后，第二轮 8e7558ee-1a75-4237-a107-86ce09d9d839 已证明自动暂停/拒绝和中文警告，但发现列表投影遗漏失败原因；已修复并新增仓库列表断言，最终完整复测通过。两次失败报告仍保留，不计为通过。

三个测试用户目录分别检查 7、8、8 个配置、日志、数据库及 .cast 文件（两个含实际录制），未发现测试密码或跳板验证码的 UTF-8/UTF-16 明文。未解密数据库，此检查不等同于全面秘密扫描。证据 .cache/recording-bounds-privacy-check.json。

## 自动化验证与边界

18 个专项测试文件、111 项测试通过，覆盖录制容量、数量、批处理、单次在途写入、超时迟到、存储拒绝、关闭、元数据合并、录制输入失败与自动派发竞争，以及实际数据库列表失败原因。构建和类型检查通过；lint 为 0 错误（现有 100 条警告），中文词条检查通过。

本轮新增 recording-writer 归属终端录制模块，types/terminal-recording 仅承担终端服务、MCP 与 UI 共享的失败代码契约；未增加通用 helpers 或反向依赖。全量输出/模型上下文、所有存储故障、长时录制和播放器大文件验收仍未完成。本轮只界定每个录制的队列；不能取消已经交给操作系统的单次写入，也不宣称限制了所有会话加总的在途操作。

最终应用回归：494 个测试文件通过、1 个跳过，3517 项测试通过、12 项跳过，耗时 264.93 秒。命令为 vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2；独立 ConPTY 门禁不包含在本机这个结果中，远端 CI 仍保留该门禁。最终 Windows 包通过 13 项原生依赖探测、3 项打包 MCP 测试，隔离 Codex 发现 38 个工具；未调用付费模型、未修改日常 Codex 配置。日志：.cache/recording-bounds-regression.log、recording-bounds-types.log、recording-bounds-native-probe.log、recording-bounds-package-mcp.log、recording-bounds-localization.log。
