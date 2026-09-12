# 历史分页真实桌面验收

当前源码构建本地 --win --dir --publish=never 验收包，启动独立 Windows 数据配置，通过实际后台与本机模拟模型生成 54 个会话（含完整工具会话、中断会话）。正常退出后重新启动并操作历史界面。

报告：`.cache/desktop-observation-report-eaf3f9fa-38b9-4b6a-ba92-709e1d20c4bb`。脚本 `.cache/chat-pagination-observer.cjs`、`.cache/run-chat-pagination.cjs`。

## 实际结果

- 首次历史选项为 50 条，旧中断会话 ID 不在首屏。
- 点击可见中文“加载更早会话”后选项共 54 条，54 个唯一 ID，没有重复，末页后按钮消失。
- 从新增的旧选项打开中断会话，显示保留正文和中文中断说明。
- 继续保留原完整会话续聊、新会话独立 ID、加密数据库正常退出重启与模型工具历史读回断言。
- 两次桌面正常退出、端口释放、模拟服务关闭，最终观察脚本退出码 0。

restore/pagination-result.json 实际值为 initialCount=50、totalCount=54、uniqueCount=54、oldRecordAccessible=true、noMorePages=true。before-load-older.png 与 interrupted-history.png 已查看，无欢迎对话框遮挡；真实按钮与旧正文均可见。

本轮 58 次请求全部指向本机模拟模型（52 个分页填充会话使用无工具的简短回复），没有付费模型、业务服务器或日常 Codex 配置更改。

## 范围

历史分页按钮已完成真实桌面链验证，不只依赖 DOM 替身或数据库单测。同包包含聊天并发限制，但本轮串行请求不证明多窗口并发错误展示；该范围仍需单独验证。资源容量的其他维度仍未闭环。

目录包仍显示 alpha.12 但包含后续源码，不能当作公开 alpha.12 安装包已更新；本轮未发布安装包。
