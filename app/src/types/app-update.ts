export interface AppUpdateSnapshot {
  currentVersion: string;
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error"
    | "unsupported";
  installed: boolean;
  automaticChecks?: boolean;
  checkIntervalMinutes?: number;
  nextCheckAt?: number;
  lastCheckedAt?: number;
  latestVersion?: string;
  releaseUrl: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  };
  error?: string;
}
export interface DesktopUpdateApi {
  action(
    action:
      | "status"
      | "check"
      | "download"
      | "cancel"
      | "install"
      | "open"
      | "auto-check-on"
      | "auto-check-off",
  ): Promise<
    { ok: true; value: AppUpdateSnapshot } | { ok: false; error: string }
  >;
}
