# 旧主机导入桌面验收与首页刷新修复

2026-09-12，对 193—195 的旧主机 JSON/SSH 配置导入进行实际 Windows 打包客户端验收。

## 实测

隔离用户数据目录，使用 CDP DOM.setFileInputFiles 操作真实文件输入，文件读取、浏览器原生确认框、导入 HTTP、应用数据库均未替换为 mock。观察器只对本次测试文件的指定确认阶段接受，其余取消。

- JSON：第一次取消不新增主机，第二次确认新增一台。
- SSH 配置：第一次取消不新增主机，第二次确认新增一台。
- 四次中文确认框均显示预期文件名、连接声明和“覆盖已有连接：否”，JSON 还显示凭据数量。
- 从实际主机 API 读取两条导入配置，验证 enableTunnel=false、metricsEnabled=false、statusCheckEnabled=false、disableTcpPing=true。
- 页面显示中文新增/更新/跳过/失败计数；客户端正常退出，观察器退出码 0。

最终报告 `.cache/desktop-observation-report-f560afac-fd90-4c60-8080-02f1d306cb52/host-import-result.json`；`host-import-chinese.png` 已查看，显示两台主机及中文结果。

## 发现并修复

第一次报告 8112e454-bfbf-4f35-9fbb-e8ba18a3ac7b 中导入行为通过，但截图显示侧栏两台、首页总数零。DashboardTab 原本只在加载及每 30 秒刷新主机列表，没有响应主机变更通知。

现增加 termix:hosts-changed、ssh-hosts:changed、hosts:refresh 监听，与定时刷新共用 load。请求代次及挂载状态校验防止旧响应覆盖新列表；读取失败保留已有列表，卸载移除监听。只修改 DashboardTab 的列表编排，未新增模块或改变采样授权条件。重新 build、目录打包后，真实导入复测在 10 秒断言窗口内显示“2 主机总数”，截图已确认。

ESLint、TypeScript、build 和本地 electron-builder --win --dir --publish=never 均通过。本轮没有新增单元测试；真实桌面复测验证导入触发的首页更新，不泛化为所有异步竞态的测试证明。

## 剩余边界

本轮仅桌面新增，真实 HTTP 新增/覆盖矩阵另见 195。导入摘要仍未逐项显示全部高级字段及覆盖差异，后端没有绑定预览令牌；高级配置消费者、运行中资源影响仍需核对，A22 不标为完成。公共 alpha.9 不含这些后续修复，未本地上传安装包。
