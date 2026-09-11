# 桌面命令规则管理闭环验收

2026-09-12。本轮使用新的本地 Windows 目录包（alpha.6版本元数据，包含后续开发修改），独立 profile，连接隔离 Alpine/OpenSSH VM 73593d5f-8dda-4683-b852-96001bfc80a7。没有改动常用客户端数据或公开安装包。

最终报告 .cache/desktop-observation-report-a07effba-97f4-4a91-9cca-5940236ba6e1/policy-desktop-result.json；此前基础报告1c6fa9de与四范围报告9c4f2689分别验证相同流程的较小范围，最终报告重复并补齐移除操作。

从真实终端打开“协作执行→命令黑白名单”，修改测试 profile 的一条全局规则为禁止 touch。只试算 touch <测试根目录>/trial-must-not-run，显示规则拒绝；真实 GET /tandem/policy 与基线一致，独立 SFTP 确认标记文件没有被创建。保存按钮在未勾选确认时禁用，勾选后保存，后端版本从1变2；关闭/重新打开显示已保存规则且确认复选框未沿用，重新试算仍拒绝且无远端副作用。

继续从界面新增分组(tag:fixture-policy)、主机(实际测试主机ID)和任务(policy-fixture-task)范围，各添加touch拒绝规则。保存后版本3、四个范围齐全；关闭/重开逐一选择范围，标识和规则程序均保持。任务ID用于范围配置存储验证，没有声称创建或执行同名任务。最后通过界面移除任务范围、明确保存，后端版本4且剩三范围，关闭/重开仍为三范围。

policy-draft-trial.png、policy-saved.png、policy-reopened.png、policy-four-scopes-reopened.png、policy-scope-removed.png已保存；四范围重开截图已查看，界面为中文。客户端正常退出、后端端口释放，fixture finally清理远端测试根目录。源码构建与本地打包通过。

R08证据对应：四级规则管理由本轮桌面闭环验证；冲突来源由137/138的实际React编辑器与真实求值器验证，A09已单独通过；四级拒绝、允许/确认预授权、参数范围与无关目标隔离由网关矩阵验证；保存失败/旧授权及加密跨进程恢复由139/140验证。因此将R08原始“全局、服务器组、服务器和任务规则可管理，冲突可解释”标记verified。这不把全部产品目标标记完成，也不将程序名规则宣称为远端OS沙箱。
