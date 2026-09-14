# 独立 PDF worker 资源核对

2026-09-14，承接426–428独立资源范围。

## 发现及变更

public/pdf.worker.min.js为未引用的5.3.93 worker，1,554,458字节。检索src、scripts、sw.js、Vite和发行规则，实际PdfPreview.tsx通过pdfjs-dist/build/pdf.worker.min.mjs?url引用5.4.296；旧文件仅随public复制而被重复分发。本轮移除旧文件，不替换当前预览实现或缩减PDF功能。

当前pdfjs-dist包本身已经由前端清单收录，LICENSE原文10,174字节，SHA-256 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594。这里核对文件原文，不据此宣称其全部嵌入第三方代码审查完成。

前端构建摘要此前只覆盖chunk，遗漏?url输出的独立mjs worker。现在同时收录输出bundle中的.js/.mjs资产，在writeBundle后读取最终文件摘要；验证器允许受限相对mjs路径并逐文件验证。职责仍为发行基础设施，不新增运行时依赖或共享业务抽象。

## 验证结果

17项相关测试通过，包含同时输出普通JS、独立worker和CSS的夹具，JS/worker收录而CSS不冒充脚本；修改worker会导致检查失败。类型、ESLint、完整build和Windows目录包均exit0。

实际worker assets/pdf.worker.min-qwK7q_zL.mjs：版本5.4.296，1,046,214字节，SHA-256 dbcae78a691b3c501508f74b774c6066a57a14a76cefdc9e25ad86b651bb75d5。与当前node_modules原文件逐字节相等；实际file-preview-vendor-DcClsbg9.js引用其URL。dist已无旧worker。

最终ASAR同样没有public/dist旧worker，当前worker字节匹配；前端检查packages238/chunks191/reviewItems1。包内Electron实际运行发布探针exit0，13项原生依赖及既有文件/目录/恢复/SQLite/系统凭据/PTY等通过。

证据.cache/pdf-worker-notices-result.json、pdf-worker-notices-package-result.json、pdf-worker-notices-native.log；日志pdf-worker-notices-tests.log、pdf-worker-notices-build.log、pdf-worker-notices-package.log、pdf-worker-notices-types.log、pdf-worker-notices-lint.log。

## 限制

本轮验证实际使用资源的来源、版本、引用、内容和分发，不声称新做了PDF渲染可见画面验收或所有PDF格式兼容矩阵。字体/图片、PDF库内其他第三方来源和原生库审查仍保留；前端1项与原随包npm5项原文问题未关闭。整体67/79。

未推送Git、未触发Actions，公开安装包未更新。
