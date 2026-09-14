# B04 文件浏览完整验收

2026-09-13，按原始B04“本地/远端双面板、路径栏、返回/上级/刷新、隐藏文件、排序、多选、名称筛选和属性”归并证据，标记verified。

## 本轮远端排序及导航

使用三个文件，让名称自然序、大小及修改时间三种顺序各不相同；通过真实列表列标题分别切换升降序，逐项核对data-file-path顺序。首次98dc32ef-8f28-4ab4-a8fb-a019a01c0cde排序全部通过，但双击目录后返回不可用。代码证实handleFileOpen目录分支直接setCurrentPath，遗漏navHistory。改为调用已有navigateTo，复用缓存、加载及导航历史流程，去除重复代码，无新后端接口。

成功报告 .cache/desktop-observation-report-6743bbbd-6b2e-4d5c-b1c8-bae6bc74a215：名称/大小/时间六种顺序、目录优先、双击进入、返回/前进、路径栏输入/目录、上级和刷新全部通过。remote-sort-result.json已读取。桌面、runner正常退出，SFTP夹具关闭。

## 原始标准对应证据

- 本地/远端双面板：58、59、334真实Windows窗口与双向传输。
- 路径栏、返回、上级、刷新：334本机目录与本轮远端导航矩阵。
- 隐藏文件：59真实Windows Hidden/System属性；336远端点文件开关及选择清理。
- 排序：334本机大小双向排序；本轮远端三字段升降序及自然数字顺序。
- 多选和名称筛选：334本机全选/取消单项/筛选；335远端多选与筛选同步清除隐藏目标。
- 属性：59本机只读/隐藏/系统展示，重新读取windows-attributes-result.json；265真实Linux属性对话框、链接与目标区分、明确目标mode修改后读回，重新读取link-properties-result.json。

相关生产导航修改完整build（含类型检查）、目录打包及ESLint通过。日志 .cache/remote-sort-desktop.log、remote-navigation-build.log、remote-navigation-package.log、remote-navigation-lint.log。脚本 .cache/run-remote-sort.cjs、remote-sort-observer.cjs。

不将B04扩大为所有文件操作、Windows完整ACL或任意文件系统属性支持。文件浏览通过不等于F09完整工作台已完成；传输管理、目录操作等仍独立推进。整体46/79，未推送或发布。
