# alpha.7 发布准备

2026-09-12，回归基线9420c37。准备将alpha.6之后的已完成修复通过新的Actions标签发布，不覆盖既有附件。

本版拟包含：新建文件/目录改为SFTP独占创建及中文同名冲突；复制参数、超时和HTTP断开处理；文件API保留结构化错误；四级规则来源解释与管理验收；执行历史增加unknown策略判断、失败原因、文件/目录结果和脱敏命令参数摘要。

R08与A09已有直接验收证据；新建及冲突、规则增删改查、MCP失败/执行中接管历史、旧目录记录回放均已有Windows专项。总体原始需求仍继续，秘密步骤传输的行为选择、未完成文件异常矩阵与开源许可清单不因预览版发布而视为完成。

完整应用回归进行中：vitest run --exclude src/backend/tests/collaboration/pty-integration.test.ts --maxWorkers=2，结果写入.cache/pre-alpha7-regression-results.json及对应日志。真实ConPTY仍是Actions独立必过门禁。全项目lint零错误、100条既有警告。

此为发布准备记录，尚不证明alpha.7已发布；公开下载链接在验证新附件之前仍指向alpha.6。

最终应用回归：547文件通过、9文件跳过；3895测试通过、20跳过、零失败，300.55秒。机器报告.cache/pre-alpha7-regression-results.json。跳过为真实Vault1、Linux18、tmux实际Shell解析1；本轮未启动这些环境，已有专项证据不冒充本轮全量运行。ConPTY仍交由Actions独立门禁。

版本递增至0.1.0-alpha.7，仅package与lock根版本变化，依赖不变。版本/标签/预览更新/下载六文件30项通过，后端版本元数据已同步。全项目lint零错误/100项既有警告，中文缺失键0。远端已核对没有alpha.7标签，接下来创建新标签触发Release，公开发布和附件核验仍待完成。
