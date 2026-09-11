# alpha.6 Actions 发布与公开下载核验

2026-09-12，v0.1.0-alpha.6 已由 [Release Actions 34644938351](https://github.com/Zhqiankun/TandemSSH/actions/runs/34644938351) 成功发布。固定源码 6ade398bb25d960ba9f4cfa5439cd84f85fe905b。云端源码、真实终端、Windows 打包、原生模块、安装/在线升级/卸载与更新清单检查通过；没有上传本地构建物替代 Actions。

[公开预览发布](https://github.com/Zhqiankun/TandemSSH/releases/tag/v0.1.0-alpha.6)，draft=false、prerelease=true。附件：latest.yml 539 字节、SHA256SUMS.txt 380 字节、EXE 155442289 字节、blockmap 162553 字节、ZIP 208275722 字节。

实际下载 EXE 的 SHA-256：6cb425c0a9260819c64864940b1d4a995a6749dbcea09ea978a06308c8a99706。与 GitHub 资产摘要和 SHA256SUMS 一致；SHA-512、版本与大小同时匹配 latest.yml。latest.yml SHA-256 为 779974950a498f52340e0f77be976e316cd34d0e119b823f55f75b1fee5e1c37，SHA256SUMS 为 786cb36740412d57c40abcc09b01538822ae8be6a90b7cd773e29c22ac5fdc31。原始结果 .cache/alpha6-download-verification.json；ZIP 与 blockmap 本轮只核对公开元数据，没有冒充整包下载验证。

保留的 alpha.4 Windows 开发目录客户端，以独立 profile 访问真实 GitHub 更新源，检测到 alpha.6。中文弹窗显示当前/可用版本与每 20 分钟检查，截图已查看；客户端正常退出。报告 .cache/desktop-observation-report-a21dcb62-2f6b-4dd6-9aba-d74a549d41a7/public-alpha-update-result.json，截图 public-alpha-update.png。networkRedirected=false、installed=false，因此这是公开新版发现证据，不等同于本机两个公开安装包间的覆盖升级；云端安装升级另有独立门禁。

alpha.6 包含文档 129 所列截至源码标签的修改，尤其真实目录复制/移动/撤销、文件冲突保护、编辑器汉化、队列反馈与 AI 草稿/预算修复。标签之后的复制请求校验、超时和 HTTP 断开修复未包含在该安装包中。完整原始需求仍继续实施和验收，开源声明、秘密步骤执行以及剩余界面异常矩阵没有因发布而标记完成。
