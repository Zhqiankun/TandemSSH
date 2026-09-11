# alpha.4 发布前回归

2026-09-11，对 f9e6c7d7370dcecdbf2eacdfd88561e680983492 的当前实现执行完整回归；测试期间保持代码和版本不变。

结果：522 个文件通过、4 个文件跳过；3712 项通过、15 项跳过，298.99 秒。证据 .cache/pre-alpha4-regression-results.json 与 .cache/pre-alpha4-regression.log。本机本轮单独排除真实 ConPTY 专项，保留 Actions 的独立 Windows 实测门禁，不把排除项算为通过。

15 项跳过逐项核对：11 项依赖显式配置的真实 Linux 夹具（SSH 基础 8、权限 1、所有权 1、链接 1）；其余为真实 Vault 签名、终端图片存储设置的一个既有跳过用例、Windows 下目录链接永久删除场景、tmux 命令真实 Shell 解析场景。它们不因全量测试成功而自动完成，既有专项记录仍按环境和代码范围使用。

回归成功后将版本改为 0.1.0-alpha.4，发行/更新/后端版本专项另有 5 文件 / 20 项通过，静态翻译键缺失为 0。推送标签提交 72c42baeadad55e736609846d61178694721b7e8，触发 [Release 34618278690](https://github.com/Zhqiankun/TandemSSH/actions/runs/34618278690)。本文件记录时云端仍在运行，未声称 alpha.4 已公开或已通过其完整门禁。

版本包含编辑器可见边界、修改时间汉化、MCP 构建版本同步及随包 npm 声明清单/九份补充原文。传递依赖和素材来源确属原始文档 10/11 的范围，五个 npm 待核对项及其他资源声明仍保留，不缩减完整目标。

已保存自有 alpha.3 开发客户端供发布后的真实 GitHub 更新发现检查；脚本 .cache/run-public-alpha4-update.cjs 已准备但未运行。主分支、下载说明与公开附件校验待 Release 成功后处理。
