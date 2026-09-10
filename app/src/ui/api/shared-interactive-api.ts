import { authApi } from "@/main-axios";
import type { SharedSSHInteractiveRequest } from "@/types/ssh-interactive-auth";
export const sharedInteractiveApi = {
  async pending(
    signal?: AbortSignal,
  ): Promise<{ requests: SharedSSHInteractiveRequest[] }> {
    return (await authApi.get("/ssh-interactive/requests", { signal })).data;
  },
  async respond(id: string, responses: string[], signal?: AbortSignal) {
    await authApi.post(
      "/ssh-interactive/respond",
      { id, responses },
      { signal },
    );
  },
  async cancel(id: string, signal?: AbortSignal) {
    await authApi.post("/ssh-interactive/cancel", { id }, { signal });
  },
};
