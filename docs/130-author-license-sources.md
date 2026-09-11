# 作者许可网页追溯补充

2026-09-12，继续文档 90 的未解决依赖声明核对。此次未修改任何发布标签、依赖版本或随包许可清单。

已成功以正常 HTTPS 下载 abstract-logging README 指向的 https://jsumners.mit-license.org/ 和 precond README 指向的 https://mturcotte.mit-license.org/，均为 HTTP 200。原始网页保存在 .cache/jsumners-license.html、.cache/precond-author-license.html。两者正文包含完整 MIT 授权条款，但版权行均显示当前年份 2026，不能将当前网页声称为旧 npm 版本发布时的快照。

进一步读取许可网站上游仓库 remy/mit-license 的 users/jsumners.json 与 users/mturcotte.json，两个配置均没有固定年份字段。这解决了“作者站点无法取得”的旧证据缺口，但尚未证明发布年份对应原文。因此不把这两项从随包待核对数中移除，也不根据其他项目猜写年份或版权行。

base32.js 的原仓库 API 返回 301，明确给出 repositories/30839087 对应提交 ac54140633c50df34172d276a21339e873a9c9af 的树入口。连接器拒绝该数字仓库端点；匿名 HTTP 请求 403，网页入口 429。均为只读检索失败，没有使用凭据提取或绕过。lazy-val 固定 npm gitHead 的树仅找到 package.json、readme.md，仍无独立声明文件。

后续需查明可追溯的历史文本或按原版权来源保留完整声明；前端资源、原生捆绑库仍是独立未完成范围。当前只更新证据，不据此声称 R01 完成。
