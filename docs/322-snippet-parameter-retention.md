# 参数片段输入不随无关渲染清空

2026-09-13，继续 F03/B03。SnippetVariablesDialog 原 useEffect 依赖整个 snippet 对象，Terminal 每次渲染重新构造该对象，因此无关界面更新也会把正在填写的参数清空。

修复：重置条件改为 snippet.id 和 snippet.content；Terminal 对快捷键参数框使用真实 pendingKeybindingSnippet.id 作为 React key，保证切换片段时即便用于展示的临时 snippet.id 为 0，也重新创建输入状态。同片段的等价对象更新不会丢失输入，不新增共享抽象或后端接口。

回归测试真实渲染参数框，填写“中文参数”后换入等价对象并提交，验证保留内容且提交 echo 中文参数；另行验证身份或内容变化会清空。修改前 1 项失败、2 项通过；修复后与派发和变量解析共 3 文件 33 项通过。日志 .cache/snippet-values-before.log、snippet-values-after.log。

本轮为组件 DOM 回归，未重新构建并验证实际终端输出引起重渲染的桌面场景。最初审查提及的异步读取失败提示仍未在本轮处理。整体 44/79，未推送或发布。
