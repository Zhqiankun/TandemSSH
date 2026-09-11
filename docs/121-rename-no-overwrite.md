# 重命名不再静默覆盖目标

2026-09-12。原 renameItem 使用 mv，目标文件已存在时可静默替换。现在复用已认证 SSH 连接的 SFTP 标准 RENAME，不用 ext_openssh_rename 覆盖扩展，不回退 Shell mv。依据 [SFTP v3 6.5](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5)，标准请求应拒绝既有目标；服务器遵守该协议是并发不覆盖的前提。

rename-item.ts 负责名称校验、目标路径、lstat 预检和标准重命名；route 负责所有权/连接检查和 HTTP 响应。newName 必须是单个名称，保留 POSIX 中文/换行/元字符的字面值；Windows 路径规范化分隔符，拒绝名称内反斜杠。已有目标返回 409 FILE_TARGET_EXISTS，中文提示使用其他名称。请求超时/连接失联返回 RENAME_RESULT_UNKNOWN，提示刷新核对，不自动重试。

SFTP 预检与操作均有 10 秒等待上限；超时不表示撤销已经发出的重命名。普通权限错误保持 403。检查后目标竞态以标准 RENAME 的拒绝语义处理，不能声称对不遵守协议的服务器仍有同样保证。

初轮文件服务 14 文件 / 125 项通过，报告 .cache/rename-no-overwrite-results.json；随后补充响应丢失测试，确认不重试也不误报冲突。路由级测试验证 409 且不启动 Shell。原 renameItem 的 Shell 成功标记用例已替换为新 SFTP 路由验证。暂无真实 OpenSSH 重命名冲突实机结果，B09 仍未整体完成；公开 alpha.5 不含此变更。
最终两文件 21 项专项、翻译键检查和 tsc -b 通过；lint 无错误，FileManager 保留原 windowId 警告。
