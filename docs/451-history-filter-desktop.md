# 历史过滤与补全的当前Windows实测

2026-09-14，承接450。当前源码build与Windows目录包exit0，日志.cache/history-privacy-build.log、history-privacy-package.log。

成功报告.cache/desktop-observation-report-3681f337-641c-4342-ac25-cc8295da58dd/history-privacy-result.json已读取，保存请求总数精确校验为2。

在实际Windows终端连接受控ssh2 shell，使用虚构测试值：

- 输入命中前端token规则的命令并回车，观察到零历史保存POST；历史读取为空，输入其前缀按Tab只发送普通Tab，不补出已过滤文本。
- 输入客户端词边界未匹配、但服务器password子串规则匹配的测试命令，实际有一次保存POST但服务器返回不保存行为；历史仍为空，前缀Tab也不补全。
- 普通命令正常保存，历史恰为该记录；输入前缀Tab只补入剩余后缀、不自动执行。总计两个POST分别对应服务器过滤尝试和普通保存，没有前端过滤命令的保存请求。

所有输入阶段等待真实SSH字节到达，再比较后续Tab或取消字节，避免异步传输造成误判。客户端cleanExit=true、runner exit0、30001–30012无监听；日志没有固定测试认证秘密。日志.cache/history-privacy-desktop.log。

这证明指定过滤规则下的当前客户端/服务端/补全路径行为，不代表能检测任意秘密或已经清理历史数据库旧记录，也不冒充真实Linux命令执行。整体67/79。未推送Git、未触发Actions，公开安装包未更新。
