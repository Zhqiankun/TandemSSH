# 前端滚动条依赖的实际代码许可关联

2026-09-14。继续R01/R11，解决react-remove-scroll-bar2.3.8前端许可来源缺口。

## 调查与关联

npm2.3.8的gitHead b3b1287aad81def2e2ae707274b74531b61ddbaf仍无法在声明仓库读取；本轮在同作者react-remove-scroll和react-scroll-locky关联仓库也返回404。没有把它当成已取得的发布归档。

本地已缓存固定上游提交8ca9ba5ea52de03308fe8ced94f7b159a44d28ff，其package.json版本为2.3.7、声明MIT，并有原始LICENSE（Copyright 2025 Anton Korzunov）。将该提交src/component.tsx、constants.ts、index.ts、utils.ts用TypeScript5.3.3静态编译，目标ES5，分别ES2015/CommonJS、React JSX、importHelpers、esModuleInterop及alwaysStrict。

最初CommonJS组件一项差异来自漏用tsconfig的esModuleInterop=true；按上游设置修正后，两种模块格式共8份JS与实际安装2.3.8全部逐字节相同。不是忽略差异、只比较文件名或仅凭MIT标识套用另一版本声明。

## 分发记录

新增app/packaging/dependency-notices/react-remove-scroll-bar-2.3.8.txt，原LICENSE完整1093字节：
SHA256 a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84。

[固定源码许可](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE)。manifest精确匹配分发2.3.8，明确sourcePackageVersion=2.3.7与实际版本不同，使用upstream-source-runtime-rebuild来源类型。docs/evidence/479-scrollbar-runtime-source.json保留源码/安装包摘要、编译参数、8项字节匹配和缺失发布gitHead事实。

这里关联的是当前分发运行时代码与被明确许可的同一源码内容，不宣称取得2.3.8历史发布提交或整个发布归档逐字节相同。

## 验证与剩余

前端声明生成/ASAR验证模块2文件17项测试通过。生产构建通过，实际dist/notices/frontend清单已包含原文和来源，react-remove-scroll-bar reviewItems为空。包内最终验证另记。

npm中base32.js/lazy-val的标准模板来源提示、precond元数据提示及原生/字体附加范围继续保留。R01/R11和完整目标未完成，整体72/79。未推送、触发Actions或公开发布。

最终Windows目录打包通过；直接校验实际ASAR的前端通知、原文摘要与JS资源摘要通过，结果.cache/scrollbar-notice-asar-result.json。打包日志.cache/scrollbar-notice-package.log，构建日志.cache/scrollbar-notice-build.log。
