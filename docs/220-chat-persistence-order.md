# 普通聊天完成通知与保存顺序

## 问题与职责

`backend/ai/index.ts` 负责将 runAgent 模型事件交付为 HTTP SSE 并保存会话。原实现直接转发模型 done，然后才 appendMessage 和 touchConversation，最后再次发送 done。界面可以在第一次 done 后认为已结束并刷新尚未保存的历史；保存失败时也已收到过完成通知。

本轮仅在路由编排层消费模型 done，保留原有消息保存与会话时间更新成功后的单次 done。不改变模型适配器、消息数据结构、共享抽象或执行权限。

## 复现与验证

新增 `backend/tests/ai/chat-persistence-order.test.ts` 使用真实 Express HTTP/SSE、受控模型生成器和异步仓储替身。助手消息写入等待 20ms，分别成功或抛错；在实际 response.write 发出 done 时记录保存和历史更新时间状态。

修复前两项均失败：成功场景捕获两个完成帧，第一个 saved=false/touched=false；失败场景仍捕获一个提前完成帧。修复后成功只捕获一个 saved=true/touched=true 的 done，失败没有 done、返回 error，且不调用 touchConversation。中文 token 流继续交付。

app 目录执行：

```text
node node_modules/vitest/vitest.mjs run src/backend/tests/ai/chat-persistence-order.test.ts src/backend/tests/ai/chat-delivery.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js src/backend/ai/index.ts src/backend/tests/ai/chat-persistence-order.test.ts
```

2 文件、7 项通过；类型和 ESLint 通过。背压、超限和中断的已有 ChatDelivery 测试一并回归。

## 限制与剩余工作

仓储和模型生成器为替身；本轮证明路由保存/通知顺序，不证明实际 SQLite 重启恢复或桌面历史刷新全过程。普通聊天的多轮工具消息持久化、错误与中断状态、并发资源上限仍需继续处理，R06/F05/F06/A23 不因此完成。

A16 的“仅当前会话内存使用 Key”仍未实现，本轮只做了现有边界评估，没有把它记为交付。此修复在开发分支，未进入已发布 alpha.12。
