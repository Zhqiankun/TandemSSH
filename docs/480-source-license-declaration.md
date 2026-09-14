# 保留元数据的源码许可证声明识别

2026-09-14。继续R01/R11，处理precond0.2.3原文已补齐、package.json缺license字段的剩余提示。

## 实现与约束

477已有准确源码版权头和作者许可链接。manifest对该条目增加sourceLicense=MIT，distribution-dependencies仅在以下条件全部满足时使用源码声明：
- 补充声明来源为已安装README指向的作者许可；
- sourceNotice指定文件在当前包目录内；
- 实际文件SHA256与清单证据一致；
- 实际文件开头与保存的原始版权/许可头完全一致，其中明确写有Licensed under the MIT license。

保留declaredLicense=null，新增独立sourceLicenseDeclaration，绝不改上游package.json。文件变动、证据无效或路径越界不能借此解除提示；元数据声明存在但与源码不同，保留LICENSE_DECLARATION_CONFLICT，不自动挑选宽松许可。

## 验证

分发声明/通知2文件14项测试通过，包含真实源码确认、改动文件拒绝、冲突保留和标准模板不能冒充上游原文。ESLint通过。

实际测试包--write及--verify通过：341包、reviewItems从3降为2。直接读取precond结果：
declaredLicense=null；
sourceLicenseDeclaration={license:MIT,file:lib/checks.js,sha256:c4d9cf144c6a41aad8d55b81a40e1fa16d851c56dc383b7c01a9f3ec6441c934}；
reviewItems=[]。

原MIT全文及2012版权头仍由477的分发通知保留。本轮改的是识别依据与证据校验，不是重新授权或修改依赖库代码。

## 剩余

随包npm仍有base32.js和lazy-val两项UPSTREAM_NOTICE_NOT_LOCATED，标准模板提示不删除。前端通知由479实际ASAR验证为0提示；原生与字体附加范围继续审计。整体72/79，R01/R11未完成，未推送、触发Actions或公开发布。
