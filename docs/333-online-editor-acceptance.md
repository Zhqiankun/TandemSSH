# B08 在线文本编辑验收归并

2026-09-13。原始要求：远程打开、多文件标签、行号、高亮、搜索替换、撤销重做、编码/换行提示、保存和另存。逐项按现有代码与真实结果核对，B08标记verified，不扩大为整个文件工作台完成。

## 当前新增直接证据

多文件报告 .cache/desktop-observation-report-6271f612-d356-47b3-8ddf-9bdfe6aa0656：真实Windows+SFTP打开文本文件，输入第一份草稿；通过“文件列表”回目录打开second.json。JSON实际渲染存在四种语法颜色，截图已查看；第二份草稿与第一份相互独立，标签往返均保持内容。未保存关闭选择继续编辑保持草稿，放弃仅关闭当前JSON，另一份草稿仍在，两个远端源文件字节未改变。multi-file-result.json通过，桌面与runner正常退出。

发现并补齐另存后的标签名同步：FileWindow依据文档当前路径通过现有updateWindow更新窗口标题。原关闭和草稿服务不变。相关标签、编码窗口和搜索3文件9项测试通过。React effect依赖随后完整包含currentWindow，ESLint复查退出0。

当前标签界面的保存复测 .cache/desktop-observation-report-05dbac45-a0d0-4a0e-bb98-d508d21225a8：搜索替换、Ctrl+Z/Ctrl+Y、覆盖能力不足时拒绝、明确另存、UTF16LE+BOM+CRLF字节匹配全部通过，并增加“替换结果.txt”标签名断言。桌面与runner正常退出。目录包build含类型检查通过；实机之后仅effect依赖补全，未改变发送/保存契约。

## 原始要求对应

- 远程打开、多文件标签：本轮多文件真实SFTP报告。
- 行号、高亮：331截图行号1/2，本轮JSON渲染颜色及multi-file-tabs.png。
- 搜索替换、撤销重做：331及本轮保存复测真实CodeMirror事件与内容断言。
- 编码/换行提示：261实际选择和保存字节矩阵，本轮保存审阅与UTF16LE/BOM/CRLF结果。
- 保存：251真实Alpine OpenSSH的原地保存及外部冲突处理，独立SFTP读取最终字节；文档服务保存边界未因标签导航改变。
- 另存：261同名拒绝、特殊文件名字面保存，本轮正常另存及新标签名。

证据日志 .cache/editor-tabs-native.log、editor-final-save.log、editor-final-tests.log、editor-final-lint.log、editor-final-build.log、editor-final-package.log。脚本 .cache/run-editor-tabs-native.cjs / run-editor-search-native.cjs。

仅证明上述标准，不声明所有语言高亮、所有SFTP服务原子覆盖、外部进程的绝对事务隔离。F09、其他传输/浏览标准继续独立验收。整体45/79，未推送或发布。
