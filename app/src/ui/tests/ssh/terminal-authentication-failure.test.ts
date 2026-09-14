import { expect, it } from "vitest";
import { terminalAuthenticationFailure } from "../../features/terminal/terminal-authentication-failure";
it.each([
  ["SSH_PRIVATE_KEY_INVALID", "连接超时", "private-key"],
  ["SSH_AUTHENTICATION_FAILED", "连接被拒绝", "credentials"],
  [
    undefined,
    "SSH key format error: Encrypted private key detected, but no passphrase given",
    "private-key",
  ],
  [undefined, "Cannot parse privateKey: bad passphrase", "private-key"],
  [
    undefined,
    "SSH error: All configured authentication methods failed",
    "credentials",
  ],
  [undefined, "Connection authentication failed", "credentials"],
  [undefined, "Permission denied (publickey,password)", "credentials"],
  [undefined, "Connection refused", undefined],
  [undefined, "Connection timed out", undefined],
])(
  "classifies %s / %s before reconnect decisions",
  (code, message, expected) => {
    expect(terminalAuthenticationFailure(code, message!)).toBe(expected);
  },
);
