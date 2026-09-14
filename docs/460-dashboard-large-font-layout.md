# 大字号仪表盘内容裁切修复

2026-09-14。针对459稳定截图直接发现的问题实施修复。

## 问题与改动

DashboardTab 的 stats_bar 默认固定96像素，加入更新和操作历史按钮后内容超过高度，旧版 overflow-hidden 裁掉按钮及状态信息；工具栏左右区不换行，中文导航和命令面板在窄工作区被挤成竖排。

本次只修改 DashboardTab.tsx 的布局编排，不引入模块或共享抽象，不改变数据接口。概览卡片采用基于容器可用宽度的网格并按内容撑高，保存的高度作为最小高度，避免恢复旧布局重新裁切。其他卡片高度逻辑保持既有行为。工具栏分组允许换行，导航文字及命令面板不拆行；面板列允许纵向滚动，使超出可用高度的内容仍可到达。

## 验证

修改文件 ESLint、npm run build、Windows 本地目录打包均通过。布局变更以真实浏览器几何与截图验证，不用镜像 className 的测试替代视觉结果。

以459同一实际配置目录（Nord、大字号、已有恢复记录）启动当前包：
.cache/desktop-observation-report-2b353e99-24b2-4e76-b97a-cbcd49b71b7c。

dashboard-geometry.json 验证概览 scrollHeight 不超过可见高度、按钮边界在概览内，导航及命令面板文字高度未被挤成多行。settings-restart.png 已实际查看：顶部两行布局清晰；版本、更新、历史和预览标记完整可见；运行时间、数据库和主机计数完整显示。沿用配置恢复冷启动断言也通过。实际进程正常退出、执行器退出0、端口释放。

日志：.cache/dashboard-sizing-build.log、dashboard-sizing-package.log、dashboard-sizing-native.log。执行脚本 .cache/run-dashboard-sizing.cjs。

## 范围

修复已复现的大字号桌面场景，不据此声称每个窗口尺寸、全部自定义卡片组合都经过视觉验收。没有新增产品验收完成项，整体仍为69/79；未推送、未触发公开发布。
