# 作者许可链接与原始版权头补齐

2026-09-14。继续431、476，对abstract-logging2.0.1与precond0.2.3保留原始版权信息并补齐README明确链接的完整许可文本。

## 新证据

精确安装版本的Readme.md/README.md分别直接链接jsumners.mit-license.org与mturcotte.mit-license.org。许可托管项目[官方说明](https://github.com/remy/mit-license/blob/master/README.md)明确：未指定年份的页面显示当前年份。读取users/jsumners.json与users/mturcotte.json，版权人分别与包作者/源码版权头一致。

因此431观察到的网页2026年不是历史发布年份的证明，也不能据此推断许可发生变化。本次不修改年份参数、不伪造历史页面，而是以原README指定网站的纯文本license.txt保留当前许可全文，明确来源和观察日期。纯文本地址也避免HTML邮箱保护产生的“email protected”占位替代实际公开作者联系信息。

precond原lib/checks.js版权头“Copyright (c) 2012 Mathieu Turcotte / Licensed under the MIT license.”完整保留在新增分发通知中，后接明确标注为当前作者链接快照的MIT原文；原源码未修改。

## 文件与验证

新增：
- abstract-logging-2.0.1.txt：1112字节，SHA256 af15a41ce02371f77476b7a201e036c0ae6c5d6d2a233b4e5f0fd5fca123457e。
- precond-0.2.3.txt：1412字节，SHA256 437f61f6754e66b029d4e5ef25b21d03b68b6d3b84561e6d570ede652a1d01c4。

两者位于app/packaging/dependency-notices，manifest按包名/准确版本匹配。docs/evidence/477-author-linked-notices.json保存包/README摘要、来源URL、文本摘要、版权头及作者网站公开配置。这里只声明已保留被该包链接的许可内容，不冒称取得旧版发布当年的网页。

实际win-unpacked通知目录生成及验证均通过：341个包、reviewItems包数从4降至3。声明生成/分发回归2文件10项通过。未改应用运行逻辑，未重新构建或发布业务程序。

## 剩余范围

当前随包npm提示：
- base32.js0.0.1：NO_TOP_LEVEL_NOTICE；
- lazy-val1.0.5：NO_TOP_LEVEL_NOTICE；
- precond0.2.3：仅LICENSE_DECLARATION_MISSING，完整许可原文已补齐，但package.json无license字段仍如实显示，不伪改上游元数据或修改验证器掩盖提示。

前端react-remove-scroll-bar、字体图标及原生转授范围也继续保留。整体72/79，R01/R11未完成。没有推送Git、触发Actions或发布安装包。
