# Linux 上传冲突与 B07 验收

2026-09-14。当前 Windows 目录版连接本轮独立 Alpine 3.24.1 / OpenSSH 测试机，实际验证上传原子覆盖路径；未重新发布软件。

## 实际环境和证据

测试机34ecfeb1-47f8-46aa-b2ca-e6a59e17dc8c经启动器主机密钥核对并输出vmReady，UID1000。远端写入限定linuxFixture创建的/home/alpine/tandem-test/case-UUID，结束由夹具清理。客户端使用独立数据目录和本机测试目录；原生目录选择器仅固定返回该测试目录，传输仍经过真实UI、IPC、后端、SSH/SFTP和Linux文件系统。

报告：.cache/desktop-observation-report-cdef99d2-952a-4708-b2e5-161e42c0b45c/linux-upload-conflict-result.json。截图linux-upload-mixed-preview.png已查看，父目录与空目录“合并目录”、保留.txt“跳过”、结果 %.txt“覆盖文件”、本机专有.txt“新建”均与预期一致。脚本.cache/run-linux-upload-conflict.cjs、linux-upload-conflict-extra.txt；日志linux-upload-conflict-native.log、linux-upload-conflict-launch.log。

- 默认冲突不能开始，本批覆盖文件不会隐式合并目录。
- 父目录改名后重新检查，文件和空目录写入新目录，原远端文件保持不变。
- 整目录跳过后队列显示子文件已跳过，远端没有新增本机专有子文件，原远端文件不变。
- 对原目录显式选择本批覆盖及本批合并，再单独把保留.txt改为跳过。确认前通过独立SFTP读取原内容；确认后结果 %.txt成为准确的本机内容，本机专有.txt新增且字节正确，保留.txt仍为原远端内容，本机源文件未改变。成功结论依据真实文件读取，不只依据队列标签。

客户端正常退出，验收脚本exit0。测试机停止脚本按精确清单核对身份后请求关机，超时后forced=true；启动器报告vmExited、code0。这里不把测试机强制退出描述为正常OS关机。停止日志linux-upload-conflict-stop.log。

## B07 原始范围与完成依据

原始验收：同名跳过、改名、明确覆盖、逐项/本批策略；不能默认合并覆盖全部目录。

| 原始条款 | 当前直接证据 |
| --- | --- |
| 同名跳过 | 347下载父级跳过无后代写入；348上传父级跳过及单项保留 |
| 改名 | 346真实服务路径/旧预览失效；347双向桌面父目录改名及文件/空目录落盘；348真实Linux上传改名 |
| 明确覆盖 | 347下载逐项明确覆盖实际内容更新；348Linux上传明确覆盖实际内容更新 |
| 逐项与本批策略 | 344组件策略边界；347逐项目录合并和覆盖；348本批覆盖/合并后单项跳过仍保留 |
| 不默认合并覆盖目录 | 347双向桌面默认禁止及本批文件覆盖后仍禁止；348Linux同样验证 |

据此仅将B07标记verified，整体48/79。B05完整传输、B06动态并发、F09完整文件管理范围不随之标记完成。本次没有修改产品代码、API契约、模块依赖或共享抽象；公开Git与Actions发布继续留到功能完成后。
