# 浮动文件编辑器可见边界

2026-09-11，Windows 链接验收的截图发现浮动编辑器超出文件工作区，右侧和底部控件被裁剪。默认初始坐标和 900×660 尺寸没有在挂载时受容器约束；已有约束只在拖动、缩放时执行。

责任：DraggableWindow 拥有浮动窗口的可见性；同目录 window-geometry.ts 只计算该窗口在定位容器内的位置和尺寸，不成为跨业务通用工具。通过 offsetParent 的尺寸确定坐标边界，ResizeObserver/窗口 resize 更新容器尺寸，布局阶段在初次显示、拖动缩放结果、还原最大化和容器变化时夹紧窗口。正常尺寸保留既有位置与顶部操作区，小容器以控件可见优先于最小尺寸。没有后端、数据或文件内容修改。

5 项测试通过（2 文件），包括实测溢出尺寸、既有位置保留、小容器、隐藏/重复计算稳定，以及 React 组件初始纠正、容器缩小和中文关闭操作。类型和修改文件 ESLint 通过；证据 .cache/window-bounds-tests.log、.cache/window-bounds-types.log、.cache/window-bounds-lint.log。

真实 Windows 重新构建和可见关闭按钮复测仍待进行，本项未完成实机验收。修复在 alpha.3 标签之后，不包含于正在构建的 alpha.3。
