# A31：编码转换与特殊文件名桌面闭环

2026-09-13。

原始 A31：编码、换行、BOM、特殊文件名，无损或明确提示转换，不触发命令注入/重名覆盖。

## 最新桌面结果

本轮重新 build 和打包本地 win-unpacked，包含第 252、260 号生产修复。仍为 alpha.14 版本号，不等同于公共 GitHub alpha.14；未生成公共安装包或上传。

实际 Windows 客户端 + loopback SSH/SFTP 报告：.cache/desktop-observation-report-43b16f91-2adb-4bbc-9f76-a1d279ddddf6。

1. 打开 UTF-16 LE BOM + CRLF 的中文文件，实际重新读取编码下拉框为 UTF-16 LE，验证第 260 号修复。
2. 输入“中文😀”和第二行中文。选择 GBK 并确认保存后，中文提示不能完整表示草稿；服务端没有新增写入，原文件字节不变，草稿完整保留。
3. 改回 UTF-16 LE、勾选 BOM，尝试另存到已有文件，明确报另存目标已存在，既有文件不变。
4. 改用字面文件名 /中文 ' %2F ; $(touch marker).txt 并明确保存。真实保存字节与独立 Node UTF-16 LE 字节 + FF FE BOM + CRLF 完全一致，共 20 字节；原文件及同名冲突目标未被修改，marker 不存在。
5. 保存后下拉框仍正确显示 UTF-16 LE，客户端正常退出，后台端口释放，夹具关闭。

encoding-result.json 已读取。lossy-conversion-rejected.png 和 encoded-special-file-saved.png 已实际查看：中文错误、两份内容、选择编码、字面文件名、保存成功和编辑内容可见，无弹窗遮挡。

此处通过 SFTP 将特殊名字作为数据传递，不使用 Shell；不是 Windows 上模拟 Linux 权限的证据。

## A31 组合覆盖

- 第 259 号独立固定字节矩阵：五种编码，Unicode 编码有/无 BOM，LF/CRLF/CR/无换行，非法或截断输入及 BOM 冲突，共 38 项。
- document-service.test.ts：混合换行须明确选择，有损编码拒绝，保存流程使用编码器并保留版本/目标边界。
- 第 56 号与既有真实 SFTP 测试：Unicode、引号与百分号路径；第 190 号真实共享 PTY 参数字面值验证补充命令路径。
- 本轮桌面：自动识别、错误转换反馈、同名拒绝、特殊文件名字面保存及独立最终字节校验。

据此 A31 标记 verified，不宣称验证所有 Unicode 映射表、所有服务器或所有文件协议；其他文件功能的独立原始验收项继续保留。

本轮除构建外没有新的生产修改、共享抽象或依赖变化；新增隔离脚本与验收记录。未提交、推送或触发 Actions。
