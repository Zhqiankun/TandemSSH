# SPDX 标准文本与上游原文的区分

2026-09-14。继续R01/R11，对base32.js0.0.1和lazy-val1.0.5核对准确发布元数据和分发声明真实性。

npm官方package.json说明允许使用SPDX标识声明标准许可证；两包安装版本及476取得的准确提交package.json均明确license=MIT。[npm说明](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license)。这提供发布者声明依据，但不等于取得独立的上游LICENSE或版权原文。

## 本轮变更

分别增加补充通知，保留准确name/version/author/license/repository元数据，后接[SPDX官方MIT标准文本](https://spdx.org/licenses/MIT.html)。文件明确写明：
- 作者字段是发布者元数据，不推断为完整版权持有人清单；
- 标准文本不是上游原始LICENSE文件；
- 未补写年份或版权人，模板占位保持原样；
- 原文来源核对仍未结束。

文件位于app/packaging/dependency-notices：
base32.js-0.0.1.txt SHA256 d5801d14eb2da47e43c07d81f56f3afefe8d29c7f12f84d4f8d9a2c4bd229944；
lazy-val-1.0.5.txt SHA256 eff45eaaf98a017a4ad435df77bcc85b861dcf5e3495a8375d65b083b34d8bb2。

docs/evidence/478-spdx-supplements.json记录包清单摘要、准确提交中的package.json地址/摘要及标准文本来源/摘要。没有把其他仓库的版权头套到这两个包，也没有改上游元数据。

## 验证器改进

distribution-dependencies.cjs对declared-spdx-standard-template来源始终保留UPSTREAM_NOTICE_NOT_LOCATED。补充文件存在和摘要正确不能单独消除真实性提示，避免仅填模板使发布报告假绿。

实际测试包--write/--verify均通过，341个包仍有3个待核对包；base32.js/lazy-val为上游原文未找到，precond为元数据license字段缺失。分发回归2文件11项通过，新增测试明确验证标准文本仍保留来源警告；ESLint通过。

## 边界

本轮是补充分发信息和完善真实来源检查，不宣称两个包的全部版权核对已完成，也不据模板作法律结论。公开发布前的来源审查继续，前端及原生/字体范围不缩减。整体72/79，R01/R11仍未完成。

只更新本地测试包通知目录，没有推送、触发Actions或发布安装包。
