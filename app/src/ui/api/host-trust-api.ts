import { authApi } from "@/main-axios";
import type {
  HostTrustRequest,
  HostTrustDecision,
  HostTrustDecisionResult,
} from "@/types/host-trust";
export interface HostTrustRequests {
  requests: HostTrustRequest[];
  errors: Array<{
    id: string;
    address: string;
    port: number;
    code: string;
    expiresAt: number;
  }>;
}
export const hostTrustApi = {
  async pending(signal?: AbortSignal): Promise<HostTrustRequests> {
    return (await authApi.get("/host-trust/requests", { signal })).data;
  },
  async decide(
    input: HostTrustDecision,
    signal?: AbortSignal,
  ): Promise<HostTrustDecisionResult> {
    return (await authApi.post("/host-trust/decide", input, { signal })).data;
  },
};
export function hostTrustError(error: unknown) {
  const value = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof value === "string"
    ? value
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "HOST_TRUST_STORAGE_UNAVAILABLE";
}
