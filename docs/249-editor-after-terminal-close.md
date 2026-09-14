# 关闭真实终端后保留编辑与草稿

2026-09-13，A33 的编辑侧桌面证据。

## 场景与结果

使用当前本地 Windows win-unpacked 包（alpha.14 版本号，含第 245 号源码修复）和隔离 Alpine OpenSSH。实际创建 editor.txt=original，打开文件管理器并在 CodeMirror 输入带随机标识的未保存中文草稿。

打开同一主机的终端标签，通过真实终端输入在 Linux 创建 terminal-proof，另一路校验指纹的 SFTP 读取到 connected，证明不是未连接的空终端。点击终端标签关闭按钮，确认终端标签消失，返回唯一的原文件标签：

- 原编辑器文本与发起时完全一致。
- 点击“保存本机加密草稿”后显示成功。
- 远端 editor.txt 内容仍为 original，未把草稿写回远端。
- Windows 客户端正常退出，相关后台端口释放。

成功报告 .cache/desktop-observation-report-9e0fca28-f48d-4f37-96d0-db7adc33306b，editor-terminal-result.json 已读取；editor-after-terminal-close.png 已实际查看，唯一文件标签、中文草稿、未保存标识和本机加密草稿成功状态可见，无弹窗遮挡。

## 失败运行的界定

前一次 .cache/desktop-observation-report-26a2693f-46ba-41b8-8152-13ede22b7656 失败于验证脚本误用 termix:open-tab 新建了第二个文件标签，返回的是新页。失败状态显示两份文件标签，不能据此推断原草稿丢失。

旧进程退出后，将脚本改为点击已有唯一文件标签，再用新专用客户端完整重跑。没有修改生产逻辑来迎合脚本。

## 范围与剩余

这是实际 Windows + Linux 的“关闭终端保留未保存编辑”证明，补充第 248 号文档持有计数验证；尚未验证上传/下载进行中关闭终端，不关闭 A33 整项。

本轮新增缓存中的隔离验收脚本及证据记录，生产代码、模块职责和依赖方向未改变。没有提交、推送、打标签或触发 Actions。成功脚本退出后已删除它在 Linux 上自行创建的 UUID 测试目录。
