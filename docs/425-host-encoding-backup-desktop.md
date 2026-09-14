# 编码备份恢复后的 Windows SSH 验收

2026-09-14。承接424，当前源码 build 与 Windows 目录包均 exit 0，包含423的 tmux 分包修复和424编码备份变更。日志 .cache/backup-encoding-build.log、backup-encoding-package.log。本机目录包仅用于验收，没有上传或发布。

## 最终通过证据

.cache/desktop-observation-report-b6cfc69a-3e0a-4d87-834b-44b862536299。四份 *-backup.json 与四份 *-encoding.json 已逐份读取，runner exit 0，真实客户端 cleanExit=true，后续30001–30012无监听。日志 .cache/backup-encoding-native.log；未出现夹具密码或私钥标记。

每组通过当前客户端身份调用备份公开 HTTP 接口：源主机导出预览、下载内容相等、导入预览摘要编码相同、确认恢复。恢复结果仍为 unconfigured，未勾选用户偏好，当前测试用户无提前认证。接着按完整主机编辑契约重新提交恢复后的 terminalConfig 并仅补填认证，编码未改变。

通过真实界面打开恢复主机终端、确认指纹，建立受控 ssh2 shell。服务端按编码逐字节写入测试文本，实际页面显示正确；Chromium 原生输入提交文本，SSH 接收十六进制字节与编码结果完全一致。UTF-8/GB18030显示中文与emoji，Big5显示繁體中文，Shift_JIS显示日本語。后两种拒绝无法表示的emoji、接收字节不增加，随后OK继续发送成功。

## 失败尝试与修正

3a1da4da-b4a1-455f-a09b-746acd60c304：导入后编码已存在，测试直接用PUT仅提交认证，遗漏了完整主机保存要求的terminalConfig，随后编码为空。实际HostEditor会提交terminalOverrides；修正测试为提交恢复后的完整配置，不改产品语义。保留该限制：不能将本轮结果描述为部分PUT自动保留全部字段。

f65a3bab-e8c5-4356-b9ae-f3ac8cc98ef5：前三组收发通过，第四组因累积导入测试主机导致侧栏定位超时，不算完整通过。最终每组开始清除独立测试用户的上一组主机，使夹具始终仅包含当前源/恢复两台，再从头重跑四组。没有删除日常用户数据。

## 范围

备份和认证重绑使用实际HTTP接口；此次没有用鼠标点击备份导出/导入按钮，不能替代完整中文备份面板实机点击验收。中文编码预览由424组件测试覆盖；终端连接/指纹/显示/输入为真实客户端。测试服务器为受控ssh2 shell，非真实Linux命令执行或tmux多编码兼容测试。

此轮完成编码恢复后真实SSH收发证据，整体仍67/79，系统剪贴板、tmux旧编码兼容性及其他设置范围保留。未推送Git、未触发Actions，公开安装包未更新。
