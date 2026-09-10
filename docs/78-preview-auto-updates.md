# 预览版内部更新与 20 分钟检查

2026-09-11，按用户新增要求实施。alpha.0 未发布 latest.yml，且旧客户端只检查稳定渠道；不能据此声称预览版内部更新可用。本轮发布修复版，新版本安装后在主进程启动检查并每 20 分钟再次检查，下载/安装仍由人工触发。

更新模块拥有固定仓库和网络边界。预览版读取本仓库 releases.atom，验证标签来源、版本格式并选择最高兼容版本，然后让现有 GenericProvider 读取该不可变标签目录的 latest.yml；安装文件 URL 仍固定到相同版本、相同仓库，并校验 SHA-512/大小。稳定版继续稳定渠道。Atom 响应有容量与超时限制，不接受用户输入更新源、不使用 GitHub Token。

主进程 scheduler 只调 UpdateService.check，不下载或安装。单例、请求去重、关闭检查设置、退出清理均保留；渲染层只同步设置、读取状态并提示新版本。Actions 为稳定和 alpha 生成及上传 latest.yml，资源齐备后再公开 Release。公开旧版本不可覆盖，新发行用新标签。

验收：预览标签选择及外部 URL 拒绝、真实更新库下载/摘要/取消、20 分钟定时与禁用/退出、真实 Windows 检查 UI和公开清单；云端标准构建与安装升级门禁不降低。alpha.0 需手动安装一次修复版，随后可内置更新。

## 本机验证

更新专项 4 文件 / 18 项通过，包含最高兼容预览标签选择、固定源/非法元数据拒绝、alpha 安装包真实下载及摘要校验、取消、20 分钟虚拟时钟、慢请求不重叠、禁用与中文手动检查。类型、全库 lint（0 错误 / 100 项既有警告）、构建通过。

真实 Windows alpha.1 目录包连接隔离更新源，读到 alpha.2 的版本固定 latest.yml。最终证据 `.cache/desktop-observation-report-c1bc310b-4f78-41d7-97f0-b10eccc54df1/preview-update-result.json`：窗口最小化期间再次检查、禁用后停止、禁用时仍可手动检查、自动下载数为 0；主进程传给计时器的间隔为 1200000 ms。仅观测脚本把这段等待加速，产品代码保持 20 分钟；不声称实际等待了 20 分钟。两次早期观察被启动 3 秒后的窗口显示逻辑干扰，等待启动完成后再最小化通过，失败记录保留。

完整回归 508 文件通过、1 文件跳过，3619 项通过、12 项跳过，280.91 秒。证据 `.cache/preview-updates-regression-results.json`。最终开发包 13 项原生依赖、四份项目/底座声明及打包 MCP 的 3 项检查通过。公开包仍由 Actions 标准构建，开发目录包不用于公开上传。

上一提交 bdbbcc7 的 CI 两个 SFTP 集成场景在 15 秒时限超时。两个场景涉及 4 MiB 分块、落盘、读回摘要及重连校验，本机相同两项合计约 21 秒。TCP_NODELAY 调整无明显收益，已撤回。只把两个场景总时限改为 30 秒；文件大小、完整性断言和单次 SFTP I/O 的 3 秒期限不变。当前完整回归通过，云端仍需验证。

用户要求优先完成内置更新；任务历史导出未完成的本地工作已单独保留，未混入本次发行。现有 alpha.0 公开资源不改写，修复版标签为 v0.1.0-alpha.1。云端验收与公开清单结果发布后追加。

## Actions 发布与公开源验证通过

2026-09-11，提交 `295bf222941649ad567905a5b950d78041c30ae2` 的 [Release 34506929299](https://github.com/Zhqiankun/TandemSSH/actions/runs/34506929299) 全部成功。标准 Windows 构建、真实终端、原生组件、alpha.1 → alpha.2 隔离源安装升级、卸载和数据保留均通过；安装报告所有结果为 true、failures 为空。公开发行仅含 alpha.1，alpha.2 是未发布的升级验收夹具。

[alpha.1 发布页](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.1) 现有 latest.yml、SHA256SUMS.txt、EXE、blockmap 和 ZIP。公开 latest.yml 539 字节，SHA-256 为 `afc2034b4a9c55507d14b62ba7632d0ad080b7b297fe2883b7bcce3663da5d84`，版本为 0.1.0-alpha.1，安装包大小 155352076 字节；已下载并使用产品校验函数验证。

实际 alpha.1 桌面未改写网络，直接访问 GitHub，成功显示当前版本/可用版本均为 0.1.0-alpha.1、当前已是最新版本，以及启动/每 20 分钟检查提示。证据 `.cache/desktop-observation-report-09eaa378-78f2-4a17-9650-103e8aaacb1c/public-alpha-update-result.json` 与 `public-alpha-update.png`；截图已查看。此证明公开发现和清单读取；实际安装升级仍是上面的隔离源验收，不宣称已经通过两份公开 Release 的在线安装。
