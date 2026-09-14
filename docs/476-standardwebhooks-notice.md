# Standard Webhooks 精确分发代码许可来源

2026-09-14。R01/R11持续核对，补齐standardwebhooks@1.0.0随包许可证原文。

## 来源与不一致

npm精确版本元数据指向gitHead 929bf0c1928b188287eaf88d0a9f0a4e87df6499。该提交根LICENSE是Apache-2.0，但libraries/LICENSE明确是MIT（Copyright 2023 Svix）；JavaScript库位于libraries之下。没有套用根许可证。

同时，该提交libraries/javascript/package.json写1.3.0，不能仅凭版本号直接断言是安装的1.0.0。为验证实际代码关联，读取提交中的index.ts/timing_safe_equal.ts与tsconfig。先用本地TS6.0.3尝试，差异为模块互操作及函数导出生成方式；随后获取npm官方TypeScript5.3.3归档并核验sha512完整性，采用上游配置target es6/CommonJS/removeComments/sourceMap及旧版互操作设置重编译，仅编译文本、不执行库代码。

两份运行时JS与安装的1.0.0逐字节完全相同；进一步验证当前win-unpacked中的两份JS摘要也相同。由此将该提交下libraries/LICENSE关联到实际分发代码，同时在来源记录中保留package.json版本差异，不伪称元数据完全一致。

## 交付与证据

新增app/packaging/dependency-notices/standardwebhooks-1.0.0.txt，直接保留上游MIT原文字节：
1088字节，SHA256 5ec8c7b26b64d881a6706617bed25c049f97f2f35de034c756de8546fd6dbe27。

manifest按standardwebhooks/1.0.0精确匹配，包含提交、来源URL、npm版本与源码版本、重建编译器及证据路径。[上游包级原文](https://github.com/standard-webhooks/standard-webhooks/blob/929bf0c1928b188287eaf88d0a9f0a4e87df6499/libraries/LICENSE)。

docs/evidence/476-standardwebhooks-source.json记录发布元数据、归档摘要、编译器归档完整性、源文件及安装/重建输出摘要。npm包本体integrity取自元数据，本轮没有再次下载包本体，已明确说明；两份运行时代码的安装目录与实际测试包均直接检查。

本地测试包运行distribution-dependencies --write及--verify通过：341个包，待核对包数5降至4，standardwebhooks的reviewItems为空且原文included=true。声明生成/分发测试2文件10项通过。仅更新通知目录，没有因此把测试包业务源码说成已包含475修改。

## 其他调查结果与剩余项

base32.js0.0.1与lazy-val1.0.5的npm提交归档已取得，package.json版本匹配，但完整文件树没有独立许可证原文，README也未含完整许可段落，仍未关闭。公共GitHub tree API本轮403，使用公开codeload归档查看完整清单，未绕过认证或访问私有内容。

随包npm剩余abstract-logging、base32.js、lazy-val、precond；前端react-remove-scroll-bar及字体附加图标/原生转授范围仍需继续。不能以本次一项补齐宣称R01/R11全部完成。

整体72/79。未推送、触发Actions或公开发布。未改动或运行依赖库业务代码，没有请求用户的任何密钥。
