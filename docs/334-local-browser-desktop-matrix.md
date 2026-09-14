# 本地浏览矩阵与双向传输实机回归

2026-09-13，继续 B04/F09。真实 Windows 桌面、专用本机目录及 loopback SSH/SFTP，复用58的固定选择目录测试方式：仅目录选择结果由已核对的测试主进程指向专用路径，产品 IPC、目录读取、选择状态、上传下载与实际文件字节均不模拟。

成功报告 .cache/desktop-observation-report-c086c271-17da-4821-9ec2-85c375c1ecfc。local-browser-matrix.json：大小升/降序、全选三项及取消单项、名称筛选清空旧选择、隐藏点文件切换、进入中文目录后返回、路径栏提交相对目录、上级与刷新均通过。

首次0e0cbeaf-91fc-4649-9caf-9792065c81d9在加载中的空表格上继续点击导航失败。脚本改为读取aria-busy、等待目录加载结束和按钮可用；这属于测试时序修正，不宣称产品故障已修复。

浏览矩阵后继续原双向传输：确认上传8388621字节，关闭本地面板后仍完成；同名下载经明确冲突确认，8388625字节落盘，关闭面板后仍完成。最终SHA-256分别为af3378d46680e6c6ed484798bdb2d38c15789a18058d1cbcc3174000e3d555cf和f1066fdeffc7d4ec64b847a9ec4a1d05c78c868dec9032945ce7f51eea2fb0f0。local-panels-result.json完整通过，目录选择共2次。

桌面与runner正常退出，SFTP夹具关闭；测试本机目录留在报告内以便审阅。脚本 .cache/run-local-browser-matrix.cjs、local-browser-matrix-observer.cjs；日志 .cache/local-browser-matrix.log。本轮无产品代码修改，不声明真实系统选择器手工交互或Linux权限语义。

B04还需远端浏览完整排序/多选等证据归并，F09及传输管理其他范围独立保留。整体45/79，未推送或发布。
