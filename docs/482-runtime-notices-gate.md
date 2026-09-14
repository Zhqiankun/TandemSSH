# Electron 与 Chromium 运行时声明门禁

2026-09-14。继续R01/R11，对实际Windows包中的运行时许可文件增加可重复的完整性检查。

## 文件责任与门禁

新增scripts/verify-runtime-notices.cjs，只读取同版本node_modules/electron/dist与实际包目录的声明。源version必须与运行该探针的process.versions.electron相同；比较源LICENSE和包内LICENSE.electron.txt、两侧LICENSES.chromium.html的字节数及SHA256。文件必须在对应真实根内、为常规非链接文件、非空且不超过64MiB。使用流式摘要，不将20MiB Chromium HTML整体复制进模型输出。

verify-native-package.cjs在包内可执行程序中调用新检查，结果纳入原生探针证据。没有修改Electron许可原文或把版本不同的源文件作为基准，也没有扩大为法律意见或自动判定全部传递许可兼容。

## 测试与实际包

4文件25项测试通过：同版本两份文件匹配、缺失、修改、版本不一致、源/目标均空时拒绝，并回归项目、字体和前端声明验证。ESLint通过。

实际win-unpacked/TandemSSH.exe运行--probe正常退出0，结果.cache/runtime-notice-native-result.json：
- Electron 43.2.0；
- LICENSE.electron.txt，1096字节，SHA256 5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d；
- LICENSES.chromium.html，20313957字节，SHA256 b911161e6594ec76b872498b423c54406168f2974e0d407a847f7de1e5ff94dd；
- 原有13项依赖及SQLite、serial、keyring、PTY、文件/目录/恢复能力探针全部通过。

脚本.cache/run-runtime-notice-probe.cjs，日志.cache/runtime-notice-native.log。没有开启应用主窗口、连接SSH或调用模型。

## 剩余边界

此证据证明供应商随同版本运行时提供的声明完整保留，不等于逐条法律审查所有Chromium组件，也不能替代其他原生模块或Nerd Font附加字形的声明核对。npm两项上游原文提示继续保留。R01/R11未完整验收，整体72/79。

本轮只增加发布验证脚本和证据，没有推送Git、触发Actions或公开发布。
