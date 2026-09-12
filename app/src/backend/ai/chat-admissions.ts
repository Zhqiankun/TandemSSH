/** Ordinary-chat admission only; tasks and SSH control have separate lifecycles. */
export class ChatAdmissions {
  private active = new Map<
    symbol,
    { userId: string; conversationId?: number }
  >();
  acquire(userId: string, conversationId?: number) {
    const assertFree = (id: number) => {
      if (
        [...this.active.values()].some(
          (r) => r.userId === userId && r.conversationId === id,
        )
      )
        throw Error("CHAT_CONVERSATION_BUSY");
    };
    if (conversationId !== undefined) assertFree(conversationId);
    if (
      this.active.size >= 16 ||
      [...this.active.values()].filter((r) => r.userId === userId).length >= 4
    )
      throw Error("CHAT_CONCURRENCY_LIMIT");
    const token = Symbol(),
      record = { userId, conversationId };
    this.active.set(token, record);
    return {
      bind: (id: number) => {
        if (!this.active.has(token)) throw Error("CHAT_ADMISSION_RELEASED");
        if (record.conversationId === id) return;
        assertFree(id);
        record.conversationId = id;
      },
      release: () => {
        this.active.delete(token);
      },
    };
  }
}
