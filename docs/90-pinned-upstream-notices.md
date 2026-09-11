# 固定上游提交的声明补充

2026-09-11，继续核对剩余七项，新增两份可追溯原文，补充声明累计九份；实际包 341 个依赖的待核对项降到五个。

- @napi-rs/keyring-win32-x64-msvc 2.0.0：npm 官方指定版本元数据的 gitHead 为 f3449416a1b4bf11b0570f0a49395aacc84c8608，仓库与包中记录一致；该提交的 [LICENSE](https://github.com/Brooooooklyn/keyring-node/blob/f3449416a1b4bf11b0570f0a49395aacc84c8608/LICENSE) 是 MIT，和 npm 字段一致。保留原文件 1071 字节，SHA-256 02965ed67e29f871a53f7a7afa593a0ddc8020f86ccce0faaf1aa59215b5269e。
- drizzle-orm 0.45.2：npm 元数据没有 gitHead，因此使用实际版本标签 0.45.2 解析到提交 273c78071d4841b497f5144734b38294df7ec64b；同一提交 drizzle-orm/package.json 的名称、版本、Apache-2.0 字段已核对，再保留 [LICENSE](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/LICENSE) 原文件。来源类型明确记为版本标签，不冒充 npm 发布证明。

两份文本均通过 SHA-256 校验后进入 app/packaging/dependency-notices，继续按 name/version 精确匹配。manifest 的 source 记录固定 URL、提交、npm 来源和 integrity；后者为发布元数据原值，不声称本轮重新验证过整个 tarball。实际包重新生成与 --verify 均为 packages=341、reviewItems=5。10 项回归通过，证据 .cache/upstream-notices-tests.log。

## 未解决项及证据

剩余 abstract-logging 2.0.1、base32.js 0.0.1、lazy-val 1.0.5、precond 0.2.3、standardwebhooks 1.0.0。

abstract-logging 与 precond 的版本 README 指向作者 MIT 许可网站，但本次浏览未能取得页面；不从其他项目复制作者声明。precond 的 v0.2.3 标签已解析为 12f684a7afae3dd5b7530c8c54f4f0e43096134c，源码中有版权头及 MIT 指示，尚未据此补写全文。base32 仓库接口发生迁移，保留待核对状态。lazy-val 的发布提交树未找到独立声明文件。

standardwebhooks 1.0.0 的 npm license 字段为 MIT，而其 gitHead 929bf0c1928b188287eaf88d0a9f0a4e87df6499 的项目根 LICENSE 为 Apache-2.0；JavaScript 子目录未发现独立 LICENSE，因此没有把根声明套给该包。这是需要继续查明的来源差异，不据此断言项目违规。

前端资源和原生捆绑库仍是独立范围；以上补充不构成完整许可结论，也尚未包含在 alpha.3 中。
