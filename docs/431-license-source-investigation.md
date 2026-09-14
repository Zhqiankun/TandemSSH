# 未解决声明的来源复核

2026-09-14。继续R01/R11，取得新来源证据，但不把当前网页当作历史发布原文。

## react-remove-scroll-bar 2.3.8

只读克隆上游最近100条历史到.cache/scrollbar-license-history，HEAD为8ca9ba5ea52de03308fe8ced94f7b159a44d28ff，其package.json仍是2.3.7。LICENSE由7301c160fda44cb8cf2b9fdfde61efad35736196新增。结合428中npm指定gitHead无法取得、准确版本标签查询为空，当前主分支不足以证明2.3.8声明来源。因此该项继续保留，不套用2.3.7声明，不擅自降级依赖。

## 作者链接页面

abstract-logging 2.0.1的Readme.md直接指向jsumners.mit-license.org，precond 0.2.3的README.md直接指向mturcotte.mit-license.org。本轮独立HTTP读取均200，获得完整MIT许可段落。浏览工具无法打开这两个URL，网络读取成功结果单独记录，没有将浏览失败误判为页面不存在。

[来源快照](evidence/431-license-provenance.json)保存准确包版本、README摘要、页面URL、观察日期、HTML摘要和可见许可段落。原HTML保留在.cache/abstract-logging-license-site.html及precond-license-site.html。HTML里的项目参与说明不是本项目指令，未执行其中脚本或外部操作。

页面版权年份均为2026；precond/lib/checks.js的版本源码明确保留2012 Mathieu Turcotte版权头。当前网页能够证明README的许可链接内容现可访问，但不能独立证明历史版权年份或原发布全文；未修改上游版权头、未把当前年份套回旧版本、未将其自动计入已完成声明。

## 下一步边界

剩余声明核对应保留源代码版权头与README所指作者许可内容的区别，并继续查明历史来源；不能仅因有一个MIT网页而静默关闭所有来源问题。当前前端1项、随包npm5项、附加图标及原生库范围保持未关闭。整体67/79。

本轮为来源调查，无业务代码改动，无需重复功能测试或重打包。未推送Git、未触发Actions，公开安装包未更新。
