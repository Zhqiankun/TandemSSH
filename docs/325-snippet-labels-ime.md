# 参数标签汉化与输入法保护

2026-09-13，继续 F03/B03。extractSnippetInputs 增加可选默认标签格式化参数，兼容旧调用；片段参数框和集群命令界面使用翻译词条，简体“参数 {{number}}”、繁体“參數 {{number}}”。仅默认名称本地化，显式 ${INPUT_n:自定义名称} 保持原文。

SnippetVariablesDialog 使用 useId 将 label.htmlFor 与输入框 id 关联。DialogContent 的 Escape 回调在 isComposing 或 keyCode 229 时阻止关闭，不阻止输入法自身默认行为。普通执行仍由明确按钮触发，不新增自动提交。

责任：参数解析仍不依赖 i18n，UI 提供标签格式化；无新增共享模块、后端接口或命令语义变更。集群界面在语言变化时重新生成默认标签。

验证：默认标签本地化和自定义标签保留、输入关联、组合状态 Enter/Escape 不执行也不取消；与变量解析、连接绑定和参数保留共 3 文件 43 项通过。日志 .cache/snippet-label-tests.log。尚未重建目录包验证 Windows 实际输入法候选窗口，不能将 DOM 事件测试等同系统输入法验收。

整体仍 44/79，未推送或发布。
