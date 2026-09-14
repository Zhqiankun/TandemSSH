# 移动提交后响应丢失与未知结果分类

2026-09-14，继续F09/B09。

## 故障夹具与证据纠正

fileSftpFixture新增disconnectAfterRename测试选项，在实际fs.rename提交并更新元数据后，用服务端SSH Connection.end()关闭本次连接，不发送成功状态。初版错误调用未提供的destroy()，导致抛出异常后返回通用SFTP失败，报告76b0908b-6f52-461a-a659-b8abd6d852e4不能算真实断线证据，只能算提交后的服务端异常。类型检查发现并修正此问题后重新执行完整测试。

## 产品错误分类修复

审查发现：通用SFTP code4失败后若目标已出现，moveFileItem原来直接报告FILE_TARGET_EXISTS。但目标可能是本次已提交、未确认的重命名结果。现在该分支额外检查源路径；源不存在或无法确认时返回RENAME_RESULT_UNKNOWN，移动接口映射为MOVE_RESULT_UNKNOWN，不进入复制回退、不重试。原有源和目标均存在的同名竞态仍保留冲突结果。

新增“code4失败但源已消失”回归，修改前失败；修改后重命名、移动命令与批次3文件27项通过。TypeScript、ESLint退出0；成功编译后重新打包，避免使用失败编译产物。

## 真实断线最终报告

.cache/desktop-observation-report-49db08a9-6d22-4a96-b02b-4df211190785：三个文件拖放移动，第一项确认，第二项实际重命名后SSH关闭、响应丢失。独立读回确认两个文件在目标目录，第三个仍在源目录；实际重命名次数2，无重试。中文批次提示只确认1/3，并明确显示“移动结果尚未确认”。move-disconnect-result.json通过，桌面与runner正常退出。

脚本 .cache/run-move-disconnect.cjs、move-disconnect-observer.cjs；日志 move-disconnect-desktop.log、move-unknown-before.log、move-unknown-after.log、move-unknown-tsc.log、move-unknown-lint.log、move-unknown-package.log。此处使用受控SSH/SFTP和真实文件重命名，不是Linux权限测试。

本轮未验证断线后重新连接再处理剩余项目的完整交互，也未把未知的第二项当作可自动撤销。B09仍未完成，整体46/79，未推送或发布。
