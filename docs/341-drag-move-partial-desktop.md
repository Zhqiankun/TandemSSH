# 拖放移动部分失败与撤销实机验收

2026-09-14，继续F09/B09，验证338–340的拖放与批次保护。

真实Windows客户端+loopback SSH/SFTP，选择move-a.txt、move-b.txt、move-c.txt并拖到target目录。target/move-b.txt预先存在且内容为KEEP，产生真实同名冲突，不模拟API错误。

成功报告 .cache/desktop-observation-report-bf281d01-c79f-4133-a47c-e6778c8c00ce。独立SFTP读取确认：第一项只存在于目标目录且内容A；第二项源B与目标KEEP均不变；第三项源C仍在且目标不存在。实际中文提示“移动已停止：已确认1/3项”可见，move-partial.png已查看。

随后在实际网格使用Ctrl+Z，第一项恢复到原路径、目标副本消失；第二项、冲突目标和第三项均保持原内容，证明撤销记录只含确认成功项。drag-move-result.json全部通过，客户端和runner正常退出，SFTP夹具关闭。

脚本 .cache/run-drag-move-native.cjs、drag-move-native-observer.cjs；日志 drag-move-native.log、drag-move-native-build.log、drag-move-native-package.log。拖放通过实际DOM DragEvent/DataTransfer触发，文件移动和读回使用真实SFTP；不声称验证Windows系统文件拖放或Linux权限语义。

本轮补足部分失败/撤销的实际链路，执行中断线、重连及切换会话矩阵仍未完成。整体46/79，未推送或发布。
