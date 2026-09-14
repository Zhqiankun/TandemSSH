import { beforeEach, expect, it, vi } from "vitest";
import type { AiTaskPorts } from "../../ai/tasks/runner.js";
import { AiProviderError } from "../../ai/providers/types.js";
const state = vi.hoisted(() => ({
  ports: undefined as unknown as AiTaskPorts,
  stream: vi.fn(),
  config: undefined as { apiKey?: string | null } | undefined,
}));
vi.mock("../../ai/tasks/runner.js", () => ({
  AiTaskCoordinator: class {
    constructor(ports: AiTaskPorts) {
      state.ports = ports;
    }
    setEnabled() {}
  },
}));
vi.mock("../../collaboration/files/production.js", () => ({
  directoryAutomation: {},
  fileAutomation: {},
  transferAutomation: {},
}));
vi.mock("../../collaboration/tasks/production.js", () => ({
  taskRuntime: {},
  journalFor: () => ({ record: async () => {} }),
}));
vi.mock("../../collaboration/workflows/production.js", () => ({
  workflows: {},
}));
vi.mock("../../ai/access-events.js", () => ({
  onAiAccessChanged: () => () => {},
}));
vi.mock("../../ai/gating.js", () => ({
  resolveAiAccess: async () => ({ enabled: true }),
}));
vi.mock("../../ai/providers/registry.js", () => ({
  getAdapter: () => ({ streamChat: state.stream }),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAiRepository: () => ({
    findProvider: async () => ({
      providerType: "openai_compatible",
      baseUrl: "http://127.0.0.1/v1",
      enabled: true,
      label: "fixture",
    }),
    findProviderWithSecret: async () => ({
      providerType: "openai_compatible",
      baseUrl: "http://127.0.0.1/v1",
      enabled: true,
      apiKey: "fixture-private-value",
    }),
  }),
}));
import "../../ai/tasks/production.js";
beforeEach(() => {
  state.stream.mockReset();
  state.config = undefined;
});
async function collect() {
  const chunks = [];
  for await (const chunk of state.ports.stream("owner", 1, {
    model: "fixture",
    system: "test",
    messages: [],
  }))
    chunks.push(chunk);
  return chunks;
}
it.each([
  [401, "MODEL_AUTH_FAILED"],
  [403, "MODEL_AUTH_FAILED"],
  [429, "MODEL_RATE_LIMITED"],
  [500, "MODEL_REQUEST_FAILED"],
] as const)(
  "maps provider status %s without exposing raw detail",
  async (status, code) => {
    state.stream.mockImplementation(async function* (config) {
      state.config = config;
      yield await Promise.reject(
        new AiProviderError("server echoed fixture-private-value", status),
      );
    });
    await expect(collect()).rejects.toThrow(new RegExp("^" + code + "$"));
    expect(state.config?.apiKey).toBeNull();
  },
);
it("preserves bounded response errors instead of relabelling them", async () => {
  state.stream.mockImplementation(async function* () {
    yield await Promise.reject(new AiProviderError("MODEL_RESPONSE_TIMEOUT"));
  });
  await expect(collect()).rejects.toThrow("MODEL_RESPONSE_TIMEOUT");
});
