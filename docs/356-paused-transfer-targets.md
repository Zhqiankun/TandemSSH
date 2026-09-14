# 暂停后的来源/目标变化保护

2026-09-14，继续A29/F09。

## 本轮已验证场景

上传来源：实际Windows客户端上传12,582,929字节并暂停，远端已有8,388,608字节。替换本机来源内容，同时保持精确size和mtimeMs相同，旧任务“校验后恢复”明确拒绝；远端部分文件SHA256不变，最终目标不存在。取消后清理部分文件，刷新本机列表并重新预览上传，新内容逐字节正确。报告.cache/desktop-observation-report-87d807c5-2791-46ea-b3b9-e54120e721cb/paused-upload-source-result.json，日志paused-upload-source-native.log。该检查不声称排除所有其他文件元数据变化，只证明大小/修改时间相同仍不会盲目续传。

上传目标：暂停后在原本不存在的远端目标路径创建外部文件，恢复被拒绝，暂停字节保持不变；取消只清理自己的暂存文件。新预览改名为另存.bin后完整上传，外部文件始终保持原内容。报告.cache/desktop-observation-report-b34b509d-37aa-4108-8745-93e6595d9778/upload-target-result.json，日志upload-target-native.log。

以上均为独立Windows客户端、真实loopback SSH/SFTP、独立测试目录，目录选择器只固定返回本轮本机根。客户端正常退出、脚本exit0。

## 发现并修复的下载恢复缺口

下载目标对应场景首次失败：暂停后目标路径被外部文件占用，原实现resume只检查暂停文件，继续将剩余数据写入暂存；直到finish才发现目标变化。外部文件未被覆盖，但暂存从暂停长度增长到完整文件，UI进入“结果待核实”，不符合A29“不盲目续传”。失败报告28282d73-96db-4f00-8f20-df8acb96a8c7保留，日志download-target-native.log。

修复责任位于electron/download-sink.cjs：resume在验证暂停块之后、截断任何未确认尾部之前调用既有targetUnchanged，重新检查目标存在性、属性及内容摘要。finish原有最终检查保留。没有新增API/共享抽象/依赖；UI和服务端仍通过现有契约调用，目标变化返回DOWNLOAD_TARGET_CHANGED，恢复未进入提交阶段。

新增真实文件回归覆盖目标新建、原目标同大小同修改时间改写、目标删除三种情况；所有情况要求resume拒绝，暂存完整字节（含人为附加的未确认尾部）不变，外部目标保持原状。修改前三项均失败；修改后单文件、目录及队列3文件37项通过。

首次修复后测试框架对4MiB Buffer逐字段比较触发5秒超时，改为Buffer.equals全字节比较后通过，没有加长期限或减少内容核对。日志resume-target-before.log、resume-target-after.log、resume-target-final.log。TypeScript和ESLint通过，日志resume-target-tsc.log、resume-target-final-lint.log；本地目录包重新打包日志resume-target-package.log。

目标基线核对不能消除其他进程在检查之后改变路径的竞态，因此保留提交前最终校验；本轮不把A29升级为对所有本地/远端竞态的防御承诺。

## 修复版下载目标实测

重新打包后完整重跑通过，报告.cache/desktop-observation-report-075a555f-f511-4bb2-8a65-8d2df0870f2d/download-target-result.json，日志download-target-fixed-native.log。目标变化在恢复写入前被拒绝，暂停文件全部字节不变，外部文件保持内容；取消只删除本任务暂存文件，新预览改名另存.bin后12,582,929字节完整，SHA256为4961a77462ff43a7b6a85313e655314aabaad978c048b4c9c6295d2e51b71e54。客户端正常退出并释放端口。

## A29 原始范围审计

原始验收：传输暂停后源或目标改变，不盲目续传，提供重新传输/另存或核实入口。

| 场景 | 直接结果 |
| --- | --- |
| 下载远端来源内容变化 | 355同大小同时间替换，拒绝续传、暂停字节不变；明确取消/重新预览后下载新内容 |
| 上传本机来源内容变化 | 本轮87d807c5报告，同大小同mtimeMs替换，拒绝续传、远端暂停字节不变；刷新来源和重新预览后上传新内容 |
| 上传远端目标改变 | 本轮b34b509d报告，外部目标保留、暂停字节不变，取消只清理本任务，另存成功 |
| 下载本机目标改变 | 修复版075a555f报告，同上；原生回归另含新建/同大小同时间改写/删除三种目标变化且不截断暂存尾部 |

据此仅A29标记verified，整体52/79。A17更广的路径/符号链接/目标替换竞态、F09完整文件工作台及其他原始条款仍保持自身验收范围。当前本地目录包包含原生恢复修复，公开版本没有更新；未推送Git或触发Actions。
