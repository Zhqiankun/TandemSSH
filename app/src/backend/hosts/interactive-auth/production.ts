import type { Client } from "ssh2";
import { DataCrypto } from "../../utils/data-crypto.js";
import { resolveHostById } from "../host-resolver.js";
import { InteractiveAuthService, type InteractiveTarget } from "./service.js";
export const interactiveAuth = new InteractiveAuthService();
export function attachInteractiveAuth(
  client: Client,
  target: InteractiveTarget,
  options: {
    signal?: AbortSignal;
    authorize?: () => Promise<void> | void;
    onPrompt?: () => void;
    failure?: (code: string) => void;
  } = {},
) {
  const authorize = async () => {
    options.signal?.throwIfAborted();
    if (DataCrypto.getUserDataKey(target.userId) === null)
      throw Error("SSH_AUTH_ACCESS_DENIED");
    if (target.hostId) {
      const host = await resolveHostById(target.hostId, target.userId);
      if (
        !host ||
        host.ip !== target.address ||
        Number(host.port) !== target.port ||
        host.username !== target.username
      )
        throw Error("SSH_AUTH_ACCESS_DENIED");
    }
    await options.authorize?.();
    options.signal?.throwIfAborted();
  };
  const exchange = interactiveAuth.create(target, authorize, (code) => {
    try {
      options.failure?.(code);
    } finally {
      client.destroy();
    }
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    exchange.dispose();
    options.signal?.removeEventListener("abort", abort);
  };
  const abort = () => {
    dispose();
    client.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  client.once("ready", dispose);
  client.once("close", dispose);
  client.once("error", dispose);
  if (options.signal?.aborted) abort();
  return {
    handle: (
      name: string,
      instructions: string,
      prompts: Array<{ prompt: string; echo: boolean }>,
      finish: (responses: string[]) => void,
      password?: string,
    ) => {
      if (disposed) return;
      options.onPrompt?.();
      void exchange
        .begin(name, instructions, prompts, finish, password)
        .catch(() => {
          dispose();
          client.destroy();
        });
    },
    dispose,
  };
}
