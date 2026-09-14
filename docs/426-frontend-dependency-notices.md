# 前端构建依赖声明清单

2026-09-14。继续R01/R11开源发行范围，补齐此前仅扫描随包node_modules、遗漏已编译前端依赖的问题。本轮是来源记录与声明原文收集，不作完整许可结论。

## 实现与责任

scripts/frontend-notices.ts 属于发行构建基础设施，由vite.config.ts接入。使用实际输出JavaScript chunk的modules信息，按node_modules最近包目录识别名称、版本和相对模块路径；去重后读取对应package.json与顶层LICENSE/LICENCE/NOTICE/COPYING/COPYRIGHT文本。记录声明原值、字节长度和SHA-256，缺字段/缺原文/非UTF-8明确列为reviewItems。拒绝项目目录之外的文件、缺失包元数据和超限读取，不从别的版本补写声明。

只依赖Node文件/摘要能力及Vite插件类型，不依赖前后端业务、认证或数据库。未抽取共享业务模块。

构建输出dist/notices/frontend/inventory.json及THIRD-PARTY-NOTICES.txt。现有electron-builder的dist/**/*规则将两文件带入app.asar，无需修改业务界面。

## 实际结果

完整build exit0，清单238个前端依赖。inventory.json 164558字节，SHA-256 524a9ef64f02955cbb4c51f993ca00dc96ea50d29e7e188489e4a3100e16c33b；文本403805字节，SHA-256 bd199ef078ec8f902aa30b5a5349644058cf0eacaaf67d246f8428d8eec01882。

Windows目录包成功后实际提取app.asar两文件，与构建输出逐字节相等。证据.cache/frontend-notices-package-result.json；日志frontend-notices-build.log、frontend-notices-package.log。首轮ASAR读取使用斜杠路径报未找到，列出归档目录发现文件存在；改用path.join对应Windows路径后通过，是验证脚本问题，不是打包漏文件。

13项测试通过（前端清单与既有随包依赖清单2文件），覆盖仅收录传入输出模块所属包、顺序确定性/查询后缀去重、嵌套依赖、原文与摘要、缺声明/非UTF-8提示、越界路径拒绝和元数据缺失拒绝。ESLint与独立TypeScript检查exit0。日志.cache/frontend-notices-tests.log、frontend-notices-lint.log、frontend-notices-types.log。独立类型命令需在app目录并使用当前CLI的--ignoreConfig；前两次命令配置错误未作为类型通过证据。

## 剩余

4项前端原文待核对：@uiw/codemirror-extensions-basic-setup 4.25.11、@uiw/codemirror-extensions-langs 4.25.11、@uiw/react-codemirror 4.25.11、react-remove-scroll-bar 2.3.8。现有随包npm清单的5项来源问题仍独立保留。

此清单覆盖输出JS模块，不覆盖独立public资源、PDF worker、字体、图标资源文件或原生捆绑第三方库，也不声称完整SBOM或许可审批。没有因为有许可证字段而自动清除缺原文项。本轮ASAR核对脚本为本地验收，尚未将前端清单完整性加入长期安装门禁。

总体验收仍67/79，不关闭R01/R11。未推送Git、未触发Actions、公开安装包未更新。
