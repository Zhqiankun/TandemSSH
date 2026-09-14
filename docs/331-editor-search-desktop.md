# 在线编辑搜索替换的真实桌面与 SFTP 验收

2026-09-13，继续 B08/F09。使用真实 Windows 客户端及隔离 loopback SSH/SFTP 文件服务，打开 UTF-16 LE BOM、CRLF 文件。实际 Ctrl+H 打开中文搜索面板，查找 hello、全部替换为同舟；关闭搜索后 Ctrl+Z 恢复原文，Ctrl+Y 恢复替换结果。确认保存前远端字节保持不变。

首次报告 1c115364-3832-4d13-a9eb-dd771c7fb7cd 在原地保存断言失败：该测试 SFTP 服务没有所需原子覆盖扩展，产品明确拒绝覆盖并提示另存，不是编辑替换失败。未修改产品来绕过原子覆盖要求。

完整成功流程报告 .cache/desktop-observation-report-b3230369-3233-435d-95ea-5cec5ef7c466：在同样不支持原子覆盖时，核对原文件不变，明确另存为 /替换结果.txt，再次确认保存。独立读取 SFTP 文件，验证精确为 FF FE BOM + UTF-16 LE 的“同舟 同舟\r\n第二行”，22字节。已查看 editor-search-saved.png，行号1/2、中文内容、UTF16LE 与已保存状态可见。

editor-search-result.json通过；桌面正常退出，SFTP夹具关闭。脚本 .cache/run-editor-search-native.cjs、editor-search-native-observer.cjs（Node通过tsx加载真实fixture）；日志 .cache/editor-search-native.log。本轮无产品代码改动。

本记录覆盖搜索替换、撤销重做、行号及明确另存，不声明原地原子覆盖、多文件标签或语法高亮已由本次验证。原地保存/冲突另有251等实际Linux记录，编码另存矩阵见261，仍需按B08完整需求归并。整体44/79，未推送或发布。
