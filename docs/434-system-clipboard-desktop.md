# Windows系统剪贴板端到端验收

2026-09-14，承接423/433，完成此前缺失的真实系统剪贴板证据。

## 最终结果

成功报告.cache/desktop-observation-report-1a345703-a536-42c4-a424-6f4cf6363e48。system-clipboard-result.json、paste-native-result.json和clipboard-restore-result.json已逐份读取。客户端cleanExit=true，父测试进程exit0，30001–30012无监听。

实际Windows目录包中，通过原生鼠标拖选终端内容，Ctrl+Shift+C触发应用复制，系统剪贴板包含受控SSH标记。随后真实系统剪贴板写入测试内容并按Ctrl+Shift+V：单行立即到达真实ssh2 shell；多行预览前无发送；取消无字节；确认规范化换行且只发送一次；连接断开后确认旧预览出现中文“连接已变化，未发送内容”，SSH未收到该内容。

这是实际系统剪贴板、应用快捷键与SSH字节验证，没有以合成ClipboardEvent替代。受控ssh2 shell不执行真实Linux命令，验收对象为终端输入传输。

## 原剪贴板保护与恢复

Electron只显示text/plain、text/html，Win32还枚举Chromium internal source RFH token、Chromium internal source URL及系统文本格式，共7种。原生辅助器仅允许已识别的内存格式，未知格式在写入前拒绝。先完成捕获后原内容不变的比对，再运行测试。

原始字节只保存在辅助父进程内存，不把原剪贴板内容、URL或标记值写入日志和报告。测试后核对当前内容仍为本测试的已知文本，再恢复原始格式并逐项逐字节比对；最终结果formats7/testExit0/raw-formats-restored。这个受控夹具不是通用系统剪贴板备份产品，不声称覆盖所有并发用户剪贴板操作或全部原生格式。

## 失败记录

最初未知原生来源标记触发保护中止，未改剪贴板；补齐格式识别后只读比对通过。首轮实际操作66486686-977c-4354-9d5a-a563b19aeb99停在测试click辅助函数缺失，不能计为通过；父进程恢复7种原始格式成功。修正对话框按钮定位后，从头重跑并取得上述完整成功报告。

源码无新增业务变更；测试辅助器.cache/TandemClipboardGuard.cs、raw-clipboard-harness.ps1、raw-clipboard-observer.cjs、run-raw-clipboard.cjs；日志.cache/raw-clipboard-desktop.log。本次当前包包含430前的生产变更。

F03/B03的系统剪贴板子项现有直接证据，完整快捷键、输入法候选窗口、tmux旧编码兼容、其余字体/历史状态范围仍保留。整体67/79，不提前关闭整个终端要求。未推送Git或触发Actions，公开安装包未更新。
