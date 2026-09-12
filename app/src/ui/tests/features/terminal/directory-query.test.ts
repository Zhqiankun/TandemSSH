import { parseWsMessage } from "../../../../backend/utils/ws-message";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalDirectoryQuery } from "../../../features/terminal/directory-query";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const socket = () => ({ readyState: 1, send: vi.fn() });

it("sends the confirmed query and consumes only the matching host, socket and request", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket();
  query.start(ws, "host", "request", vi.fn());
  expect(parseWsMessage(Buffer.from(ws.send.mock.calls[0][0]))).toEqual({
    type: "get_cwd",
    data: { shellReady: true, requestId: "request" },
  });
  expect(query.consume("old", "host", ws)).toBe(false);
  expect(query.consume("request", "other", ws)).toBe(false);
  expect(query.consume("request", "host", socket())).toBe(false);
  expect(query.consume("request", "host", null)).toBe(false);
  expect(query.isPending(ws, "host")).toBe(true);
  expect(query.consume("request", "host", ws)).toBe(true);
  expect(query.consume("request", "host", ws)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("releases failed sends so the user can retry", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket();
  ws.send.mockImplementationOnce(() => {
    throw Error("closed during send");
  });
  expect(() => query.start(ws, "host", "first", vi.fn())).toThrow(
    "closed during send",
  );
  expect(query.isPending(ws, "host")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  query.start(ws, "host", "retry", vi.fn());
  expect(query.consume("retry", "host", ws)).toBe(true);
});
it("bounds lost responses and rejects late results after a retry", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket(),
    timeout = vi.fn();
  query.start(ws, "host", "first", timeout);
  vi.advanceTimersByTime(20000);
  expect(timeout).toHaveBeenCalledTimes(1);
  expect(query.isPending(ws, "host")).toBe(false);
  query.start(ws, "host", "second", timeout);
  expect(query.consume("first", "host", ws)).toBe(false);
  expect(query.consume("second", "host", ws)).toBe(true);
  vi.advanceTimersByTime(20000);
  expect(timeout).toHaveBeenCalledTimes(1);
});
it("does not notify after disposal", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket(),
    timeout = vi.fn();
  query.start(ws, "host", "request", timeout);
  query.dispose();
  vi.advanceTimersByTime(20000);
  expect(timeout).not.toHaveBeenCalled();
  expect(query.consume("request", "host", ws)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("refuses a closed socket without retaining a pending query", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket();
  ws.readyState = 3;
  expect(() => query.start(ws, "host", "request", vi.fn())).toThrow(
    "CWD_UNAVAILABLE",
  );
  expect(ws.send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not send duplicate queries in one context", () => {
  const query = new TerminalDirectoryQuery(),
    ws = socket();
  query.start(ws, "host", "first", vi.fn());
  expect(() => query.start(ws, "host", "second", vi.fn())).toThrow(
    "CWD_QUERY_BUSY",
  );
  expect(ws.send).toHaveBeenCalledTimes(1);
  query.dispose();
});
it("replaces old context without allowing old responses or timeout callbacks", () => {
  const query = new TerminalDirectoryQuery(),
    first = socket(),
    second = socket(),
    oldTimeout = vi.fn();
  query.start(first, "old-host", "old", oldTimeout);
  query.start(second, "new-host", "new", vi.fn());
  expect(query.consume("old", "new-host", second)).toBe(false);
  expect(query.consume("new", "new-host", second)).toBe(true);
  vi.advanceTimersByTime(20000);
  expect(oldTimeout).not.toHaveBeenCalled();
});
