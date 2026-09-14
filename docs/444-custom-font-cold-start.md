# 自定义字体回退与冷启动实测

2026-09-14，承接443。当前源码build与Windows目录包成功，包含自定义字体CSS转义修复；日志.cache/custom-font-build.log、custom-font-package.log。

## 真实结果

成功目录.cache/desktop-observation-report-29fcb62e-2a17-4d0a-9cd6-a207ab51cc59及同名-restart目录，两个custom-font-result.json已读取，重启后utf8-good.png已查看，终端中文、emoji和Dracula背景可见。

通过实际主机API预置测试专用缺失字体名TandemMissing "Quoted"\\Font-7d52c9、19px、Dracula和不继承外观。通过实际界面连接受控SSH，先验证原生输入字节与显示，再观察xterm调用OffscreenCanvas.measureText('W')时的字体值和度量，记录器不改变原API返回值。

xterm使用包含正确转义自定义名称的19px字体列表，字符宽10.4462890625、高22，与去掉缺失字体后同一回退链的实际度量完全一致。不是仅以document.fonts.ready/check为依据。主机API读取的字体原值、字号、主题保持；背景实际计算值rgb(40,42,54)。

第一次客户端正常退出后，第二个客户端使用同一用户数据目录重新启动，重新读取已保存主机并手动连接。字体值、度量、背景和真实SSH收发再次通过。为隔离字体恢复，测试关闭了reopenTabsOnLogin，不能将此结果作为标签自动重开功能验收。

两个客户端cleanExit=true、runner exit0、30001–30012无监听。两份desktop-process.log均单独检查，没有固定测试认证秘密。日志.cache/custom-font-desktop.log。

## 失败尝试

首次打包路径误写为app/app/electron-builder.json，改用正确工作目录后打包成功。02957378…首次启动成功，第二次被“必须新建profile”检查拒绝；d73a913f…第二次重复mkdir被拒绝。两次均在第二客户端启动前失败，不计冷启动通过。修正为初次必须无目录、明确restart必须复用本轮目录，且不重复mkdir后重新执行完整双启动，取得上述最终结果。

## 边界

这证明当前带特殊字符缺失字体的回退与一组外观冷启动，不证明所有系统字体、全部主题组合或所有Windows版本。另发现ensureTerminalFontsLoaded仍直接插入原字体名并吞掉load失败，虽本轮实际回退正确，该加载入口的统一转义还需处理。未用本轮结果关闭整个F03/B03，整体67/79。

未推送Git、未触发Actions，公开安装包未更新。
