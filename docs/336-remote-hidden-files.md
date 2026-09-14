# 远端隐藏文件显示开关

2026-09-13，继续B04/F09。审查远端排序时发现缺少隐藏文件开关。新增到既有工具栏菜单中，中文“显示隐藏文件”，按Unix点文件名规则控制可见性。默认true保持此前全部显示行为，偏好保存于fileManagerShowHiddenFiles；不推断Windows隐藏属性。

FileManager持有显示偏好并参与filteredFiles计算；FileManagerToolbar仅展示受控复选菜单项。切换显示范围时同次更新清空选择，避免隐藏文件留在复制、删除等操作目标中。无新后端接口，不改变SFTP列表读取或远端文件。

真实桌面+SFTP报告 .cache/desktop-observation-report-78acf5a8-94b0-42ba-81a1-db21805e6c98：先确认点文件可见并已选中，通过真实菜单关闭显示后条目消失且选择归零，localStorage偏好为false；再次开启显示后条目返回但旧选择不恢复。独立读取.hidden内容仍为hidden content。remote-hidden-result.json通过，桌面与runner正常退出。

完整build/目录打包、TypeScript、ESLint和翻译检查通过。脚本 .cache/run-remote-hidden.cjs、remote-hidden-observer.cjs；日志 remote-hidden-desktop.log、remote-hidden-build.log、remote-hidden-package.log、remote-hidden-tsc.log、remote-hidden-lint.log、remote-hidden-locales.log。

本轮因发现缺失能力优先完成隐藏开关，远端名称/大小/时间排序矩阵仍待完成。整体45/79，未推送或发布。
