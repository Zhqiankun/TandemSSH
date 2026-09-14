# 多选文件拖动按路径保持一致

2026-09-13，继续F09/B09。FileManagerGrid的可见选中状态使用path比较，但handleFileDragStart使用selectedFiles.includes(file)对象身份比较。当同路径列表对象被更新而选中对象仍是旧引用时，显示为多选，实际拖动仅包含当前文件。

改为与选中显示相同的路径判断：若拖动文件路径在选中集合内，拖动数据包含全部选中路径；否则只拖动指向文件。只修改网格事件编排，不改变SFTP操作、权限校验、目标目录或批次状态机。

回归真实渲染FileManagerGrid并派发dragStart，核对DataTransfer中的internal_files路径数组。虚拟滚动仅在jsdom中以确定行替代，不模拟拖动处理函数。刷新对象多选场景修改前失败，未选文件场景原本通过；修复后与选择hook和批次测试共3文件15项通过。

日志 .cache/grid-drag-before.log、grid-drag-after.log。此证据不是Windows系统拖放或真实SFTP移动的端到端证明；断线/切换后的完整目录操作仍在待办。整体46/79，未推送或发布。
