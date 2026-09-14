# Tab补全与延迟历史响应的Windows实测

2026-09-14，承接446。当前源码build与Windows目录包exit0，包含按主机隔离和合并本地编辑的补全缓存；日志.cache/autocomplete-native-build.log、autocomplete-native-package.log。

成功报告.cache/desktop-observation-report-7b47dee8-2a99-4f9b-9db8-02ed102dc7ce/autocomplete-native-result.json已读取。客户端连接真实受控ssh2 shell，预置echo CACHE_OLD历史。在网络响应阶段暂停实际历史GET，读取被暂停的真实响应确认只有旧记录；暂停期间通过原生终端输入提交echo CACHE_NEW，并等待服务器输入接受确认。

释放旧响应后输入共同前缀并按真实Tab，界面同时出现新旧两条建议。等待前缀实际到达SSH后取字节基准，菜单打开期间无额外Tab；点击新记录只发送NEW后缀，不带回车、未自动执行。证明加载期间新命令未被旧快照覆盖，原历史也未丢失。

客户端cleanExit=true、runner exit0、30001–30012无监听，日志没有固定认证秘密。证据.cache/autocomplete-native-desktop.log；脚本autocomplete-native-observer.cjs、run-autocomplete-native.cjs。受控shell只接收字节，不执行Linux命令。

## 失败尝试与纠正

07e2b4b2…请求匹配规则漏掉limit查询参数，未暂停到响应；b83a9114…测试主机未明确启用历史，种子快照不符。后续明确开启并断言种子记录id非零。另一轮在前缀仍传输时取字节基准，把迟到前缀误当Tab；修正等待实际完整前缀后，又发现测试回车写成字面量反斜杠r，改用字符码13。最终从全新隔离目录完整重跑通过，没有修改产品行为以迁就测试。

这次覆盖多个候选项、选择补全、真实延迟响应与已接受新命令合并，不冒充删除菜单、跨主机切换或所有快捷键均已实机验证。整体67/79。未推送Git、未触发Actions，公开安装包未更新。
