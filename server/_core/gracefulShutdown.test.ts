import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "./gracefulShutdown";

function fakeServer(closeImpl: (callback: (error?: Error) => void) => void) {
  return { close: vi.fn(closeImpl) } as never;
}

describe("graceful shutdown", () => {
  it("closes cleanly and exits once", () => {
    const exit = vi.fn() as never;
    const clearTimeoutFn = vi.fn();
    const server = fakeServer(callback => callback());
    const shutdown = createGracefulShutdown(server, { exit, clearTimeoutFn });

    shutdown("SIGTERM");
    shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded fallback when the server does not close", () => {
    const exit = vi.fn() as never;
    const logger = { log: vi.fn(), error: vi.fn() };
    let fallback: (() => void) | undefined;
    const setTimeoutFn = vi.fn((callback: () => void) => {
      fallback = callback;
      return { unref: vi.fn() } as never;
    });
    const server = fakeServer(() => undefined);
    const shutdown = createGracefulShutdown(server, { exit, logger, setTimeoutFn });

    shutdown("SIGTERM");
    fallback?.();

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith("[Shutdown] Grace period expired after 5000ms");
  });

  it("exits with failure when server.close reports an error", () => {
    const exit = vi.fn() as never;
    const logger = { log: vi.fn(), error: vi.fn() };
    const serverError = new Error("close failed");
    const server = fakeServer(callback => callback(serverError));
    const shutdown = createGracefulShutdown(server, { exit, logger });

    shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith("[Shutdown] Failed to close HTTP server", serverError);
  });
});
