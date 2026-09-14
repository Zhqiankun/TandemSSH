# 终端编码：后端传输边界

2026-09-13，F03/B03 范围审查确认：现有终端固定 UTF-8，没有编码选择配置；文件编辑器的多编码证据不能代替终端需求。

## 技术边界与本轮实现

新增 backend/hosts/terminal/encoding.ts，属于 SSH 终端传输模块，公开流式解码器工厂、输入转换及支持值解析。支持 UTF-8、GB18030、Big5、Shift_JIS；缺省及未识别配置保留 UTF-8。每条 SSH shell 独立建立解码器，不能在会话间共享不完整字符。界面、录制、审核和控制网关继续使用 Unicode/UTF-8，只有最终 SSH 输出解码和输入写入处转换。

session-manager.setSSHState 增加末尾可选 encoding 参数，默认 UTF-8，旧调用兼容。会话控制 write 先验证并编码输入，再执行原记录和控制权复核，最终写入 SSH。无法无损表示的输入抛出 TERMINAL_INPUT_NOT_REPRESENTABLE，不用问号静默替换。启动目录及 executeCommand 也经编码边界；启动转换错误被捕获，不成为定时器未处理异常。

新模块只依赖现有 iconv-lite 和 Node 编码能力；调用方为 terminal/index.ts 和 session-manager.ts。无业务反向依赖、新数据库表或迁移，不改变 AI/MCP 共享控制权契约。终端配置读取 terminalConfig.encoding；用户配置界面与完整配置校验仍待接入。

## 实际失败与验证

初版 iconv-lite 流式 GB18030 解码在“中文😀”字节流的第 7 字节分包时得到“中文�”。固定输入十六进制 d6d0cec49439fc36；完整解码正常，分包失败。改为 Node TextDecoder 的流式解码处理非 UTF-8；UTF-8 继续使用原 StringDecoder，保留默认行为。

逐个分包位置测试覆盖 UTF-8、GB18030 四字节字符、Big5 中文、Shift_JIS 日文；验证输入字节、控制序列和无法表示字符的拒绝。共享会话适配器测试核对 AI 和人工输入“中文”都写出 Big5 a4a4a4e5，人工接管后的旧自动控制租约仍被拒绝。3 文件 47 项通过。日志 .cache/terminal-encoding-tests.log（最初失败，后被中间通过结果覆盖）、terminal-encoding-final.log；具体失败详情记录于本文，不声称保留了原始失败日志。

## 尚未完成

编码选择界面、统一配置类型/校验、中文错误展示、终端重连配置更新、tmux 等其他非 ASCII 写入路径的完整审查、四编码实际 SSH/桌面验收仍待完成。非 UTF-8 输入的契约仍要求调用方提供完整 UTF-8 文本编码，任意二进制流不属于本接口。尚未重新打包本轮编码改动，当前目录包仍为 309 构建。F03/B03 未完成，整体 44/79；未推送或发布。
