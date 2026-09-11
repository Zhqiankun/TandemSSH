# 文件修改时间随界面语言显示

2026-09-11，针对实机截图中仍显示英文 Sep 的文件属性。后端已有 Unix 秒级 modifiedTimestamp，旧列表/编辑器却直接显示 modified 字符串。

文件管理显示模块新增 createFileModifiedFormatter：按当前 UI 语言及客户端时区格式化有效 Unix 时间戳，零值同样有效；无效或缺失时间戳保留已有文字，无原值时显示破折号，不猜测旧文本日期或时区。列表和编辑器按语言创建并复用格式器，避免每个文件单独创建 Intl 格式器。FileWindow 从实际文档 mtime 更新显示元数据，因此重新读取或保存后的属性使用新时间。原始时间戳、排序、后台日期格式和文件版本校验保持不变。

责任由文件管理 UI 持有，现有 file-manager-utils 为该业务显示工具，不新增跨业务共享层；FileWindow 只投影已返回的文档元数据。前端依赖既有 DTO，后端没有反向依赖或接口变更。

3 文件 / 18 项通过，覆盖中文日期排序、旧值回退、零/非法时间戳、无效语言、实际 FileViewer 属性的中英文切换，以及既有文件编辑状态回归。首次界面测试误处于加载状态，修正为已加载文件后通过，仅隔离无关 CodeEditor 子组件。类型、修改文件 ESLint、静态翻译键检查通过。证据 .cache/file-time-localization-tests.log、.cache/file-time-localization-types.log、.cache/file-time-localization-lint.log。

本轮未重新执行 Windows 截图验收，不声称全界面汉化完成；此改动不包含于公开 alpha.3，后续版本发行。
