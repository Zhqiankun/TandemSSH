# 四个终端字体的来源与声明

2026-09-14。继续R01/R11独立资源核对，不用前端npm声明替代字体原文。

## 字体来源

读取四个TTF的name表，均标明Version 2407.024、Nerd Fonts 3.4.0。随后取得官方[3.4.0 CascadiaCode.zip](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/CascadiaCode.zip)，逐字节匹配当前Bold、BoldItalic、Italic、Regular四文件，全部一致。没有修改字体、内部名称或字形。

发行包54,755,254字节，SHA-256 8d80993351a0a6b69a998e5c72060b7200c4f1af1f32b3ad4d8cad27c245940e。源包及对比证据位于.cache/cascadia-nerd-3.4.0.zip、font-provenance.jsonl、font-release-match.json。首次字体名称输出遇Windows GBK编码失败，改为UTF-8后完整保存。

## 保留原文与发布接线

官方字体发行包附带LICENSE和README.md，原字节保存到app/packaging/font-notices。LICENSE 4395字节，SHA-256 82c05d6c53dfa0c9025985c19e371810020b74ed2c61d51d370f2a8ab2506d52；README 3610字节，SHA-256 f992bb966c1bb8403e8b2d9fac2b8c482261034df65331dcb17b2f1a0dfdbb4c。保留README中预处理来源、版本及改名说明，不重新编写上游许可内容。manifest记录来源包和各字体摘要。

额外资源规则将原文和清单放入resources/notices/fonts。新增scripts/verify-font-notices.cjs，由现有原生发布探针await调用，核对该目录的源清单/声明及实际ASAR中public/fonts和dist/fonts两处字体。职责为发行资源验证，无业务、认证、数据库依赖；未新增共享业务抽象。

## 验证与范围

8项相关测试通过，覆盖现有四份项目声明契约、新字体资源规则、四字体和原文源摘要，以及manifest/LICENSE/README/两处字体被修改时拒绝。ESLint exit0。日志.cache/font-notices-tests.log、font-notices-lint.log。

本轮依据官方发布包保留随附声明，不据此宣布Nerd Fonts所有附加图标来源、其他字体图标或原生依赖审查完成。字体元数据中的原文与官方随附文件均保留来源记录；未用其他版本文件覆盖。R01/R11整体仍未完成，验收67/79。

未推送Git、未触发Actions，公开安装包未更新。

## 最终目录包

实际Windows目录包成功；从ASAR读取两处四字体与外置两份原文核对通过，fonts4/notices2/sourceVersion3.4.0。实际TandemSSH.exe运行原生发布探针exit0，包含字体、前端、随包依赖声明检查及13项原生依赖验证。证据.cache/font-notices-package.log、font-notices-package-result.json、font-notices-native.log。本轮没有重编译未变更的前端，仅重打包已经验证的当前构建产物；不声称进行了新的字体可见画面测试。
