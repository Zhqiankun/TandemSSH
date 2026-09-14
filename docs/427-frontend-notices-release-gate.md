# 前端声明发布检查

2026-09-14，承接426。4个缺顶层原文的前端包本地README只有许可名称或链接，未取得完整原文，因此保留待核对，不自行补写。

## 实现

scripts/frontend-notices.ts 在构建写入完成后的writeBundle/post阶段，记录最终190个输出JS文件的相对路径、长度与SHA-256，并记录声明文本摘要。构建目录中的清单仍保留238个依赖及4项待核对。

scripts/verify-frontend-notices.cjs属于发行验证基础设施：验证格式、非空清单、摘要、重复路径、目录越界和长度上限；从实际ASAR读取声明文本及每个代码文件，缺失或不匹配即失败。verify-native-package.cjs的实际Electron探针已await调用该检查，因此现有发布验证入口会执行，不依赖本机临时脚本。没有新增运行时业务依赖或数据库契约。

## 真实失败与修复

初版在generateBundle读取中间code计算摘要，真实输出AppShell文件验证失败。单元测试通过不足以证明构建契约正确。修正为最终落盘字节，并增加“中间code不同于最终文件”回归测试。后续实际dist验证exit0：packages238/chunks190/reviewItems4。

初次失败检查所在PowerShell后面紧跟类型命令，整条命令exit0掩盖前一检查失败；已明确按错误输出认定失败，没有计为通过。修正后检查单独运行并立即保留退出码。

## 最终验证

16项测试通过，覆盖缺文件/内容改动/路径越界/重复项、保留待核对项、最终文件字节与中间code差异。ESLint及独立TypeScript检查exit0。日志.cache/frontend-notices-gate-tests.log、frontend-notices-gate-lint.log、frontend-notices-gate-types.log。

当前源码完整build和Windows目录包均exit0，日志.cache/frontend-notices-gate-build.log、frontend-notices-gate-package.log。以TandemSSH.exe自身Electron执行verify-native-package.cjs --probe，包含新增前端检查与既有依赖/文件/目录/SQLite/串口/系统凭据/PTY探针，exit0，dependenciesVerified13；日志.cache/frontend-notices-gate-native.log。此处为目录包运行时探针，不是NSIS安装/在线升级全流程。

这是遗漏/陈旧产物检查，不是独立的法律许可结论或密码学签名证明；不声称自动发现所有尚未列入清单的第三方来源。字体、独立worker/图片资源、原生库，以及随包npm5项/前端4项原文问题仍保留。总体验收67/79，不关闭R01/R11。

未推送Git、未触发Actions，公开安装包未更新。
