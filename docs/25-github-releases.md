# GitHub 仓库、版本检测与在线更新

2026-09-08，实施中。用户明确要求新建个人 GitHub 项目，并参考 codexBackground 的在线更新与推送触发 Actions。

已创建公开仓库 https://github.com/Zhqiankun/TandemSSH ，本地 origin 已关联。参考目录 E:/codex-project/codexBackground/codexStyle 对应 Zhqiankun/codexDream；采用相同的 GitHub Release、electron-updater、安装标记与固定版本资源清单思路。

主进程 update-service.cjs 拥有版本状态、固定源、更新清单验证、下载取消与安装；update-ipc.cjs 校验主窗口并处理人工安装确认。界面 UpdateCenter 只编排中文状态与按钮，不接受可配置任意更新地址。安装版下载完成后由用户点击安装；免安装版可检查版本并打开发布页。

普通分支推送和 PR 运行 CI；稳定版本标签 vX.Y.Z 触发 Windows x64 的 NSIS/ZIP 构建及 Release。标签必须与 app/package.json 相同。先上传安装包、blockmap 和校验和，最后上传 latest.yml 并发布草稿；同版本已公开 Release 不覆盖，较旧版本不能覆盖最新更新渠道。

当前版本仍为开发预览。创建源码仓库不代表原始完整功能已经通过最终验收；未发布安装包时客户端应显示“尚未发布可更新的安装包”，不能显示已是最新版。Windows 首次安装及真实旧版到新版的升级仍需实际构建与验证。

## 构建与推送约定

源码位于 app，Actions 从仓库根目录的 .github/workflows 启动，npm 命令在 app 内执行。使用 Node.js 24.20.0 与锁文件安装依赖；CI 检查类型、模式、lint、中文键、完整测试及前后端构建。

发布前在 app 内执行 npm version X.Y.Z --no-git-tag-version，提交 package.json、package-lock.json 与该版本源码，再推送相同的 vX.Y.Z 标签。发布工作流不会把普通开发推送自动标记为稳定发行版。公开后的同版本不覆盖；Release 构建保留原生模块重编译，不能把 npmRebuild=false 的本地检查包冒充标准安装发行包。

更新依赖 electron-updater 6.8.9，与参考项目一致。清单校验固定仓库、版本化安装包地址、SHA-512 和体积范围；库负责实际下载校验。普通退出不自动安装。参考 [electron-builder 更新文档](https://www.electron.build/docs/features/auto-update/)；现有实现及参数也已对照已安装依赖源码核对。

根 LICENSE 为完整 Apache-2.0，原始 Termix 版权保留在 app/LICENSE 和 app/UPSTREAM.md，修改说明见根 NOTICE。参考项目仅提供发布方式借鉴，未将其更新源或产品身份复制为本项目配置。

## 当前验证证据

更新服务专项覆盖固定来源、安装包与 SHA-512 元数据、显式下载、取消、重复请求、安装门槛和首次无发行版错误。Windows 验证包中的真实仪表盘显示“检查更新 / 更新版本”，打开中文面板后能显示当前 0.1.0-alpha.0 版本和本仓库尚未发布安装包的真实状态；截图 .cache/release-preview-update.png，UI 观察记录 .cache/release-preview-ui-result.json。

完整测试为 397 文件 / 2950 项通过，5 项跳过；首次完整检查发现五个旧 i18n mock 未保留初始化导出，修正后再把两个旧英文标题期望更新为实际默认中文，未跳过失败测试。类型、前后端构建、中文键与工作流 YAML 解析通过。全库 lint 0 错误、102 警告。当前 Windows 窗口来自 npmRebuild=false 的检查包；尚不能据此宣称标准 NSIS 构建、发布后的完整安装升级已通过。GitHub 首推后的实际 Actions 结果另行记录。
