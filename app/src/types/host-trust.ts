export interface HostTrustTarget {
  userId: string;
  address: string;
  port: number;
  hostId?: number;
  hostname?: string;
  isJumpHost: boolean;
}
export interface HostTrustRecord {
  id: string;
  userId: string;
  profileScope: string;
  address: string;
  port: number;
  fingerprint: string;
  keyType: string;
  revision: number;
  approvedAt: string;
}
export interface HostTrustRequest {
  id: string;
  address: string;
  port: number;
  hostId?: number;
  hostname?: string;
  isJumpHost: boolean;
  scenario: "new" | "legacy" | "changed";
  fingerprint: string;
  keyType: string;
  oldFingerprint?: string;
  expectedRevision: number;
  createdAt: number;
  expiresAt: number;
  connectionStopped: boolean;
}
export interface HostTrustDecision {
  requestId: string;
  fingerprint: string;
  expectedRevision: number;
  action: "trust" | "reject";
  verified: boolean;
}
export interface HostTrustDecisionResult {
  requestId: string;
  status: "trusted" | "rejected";
  reconnectRequired: boolean;
}
