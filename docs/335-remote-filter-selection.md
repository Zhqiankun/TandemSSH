# 远端筛选同步清空多选

2026-09-13，继续 B04/F09。FileManager 的 filteredFiles 只根据搜索词重算可见列表，原 selectedFiles 未改变，导致隐藏条目仍留在复制、删除、下载等操作目标中。

在传给 FileManagerToolbar 的搜索回调中，搜索词变化时先 clearSelection，再更新查询。两者在同一次 React 交互中提交，不通过异步 effect 留下可见列表已变而操作目标未变的窗口。相同查询不额外清空，排序逻辑不变；无新增共享模块或后端接口。

旧目录包实机报告98f912c7-45d4-4151-b988-0aeeef64c609：真实SFTP列表选择draft-test.txt和已有.txt，输入draft-test仅显示一项但仍显示两项已选，明确失败。没有执行删除或写入。

修复后报告 .cache/desktop-observation-report-5d651c2e-3004-4eda-b76f-56404b9a8330：先断言两项多选成立，筛选到单项后已选计数为零，清除筛选后列表恢复且计数仍为零。remote-filter-result.json通过，桌面与runner正常退出，夹具关闭。

脚本 .cache/run-remote-filter.cjs、remote-filter-observer.cjs；日志 remote-filter-before.log、remote-filter-after.log、remote-filter-build.log、remote-filter-package.log、remote-filter-lint.log。完整build及目录包成功，ESLint退出0。B04其余远端排序和完整属性等仍需归并；整体45/79，未推送或发布。
