import type { Server } from "node:http";

type Exit = (code: number) => never;
type Logger = Pick<Console, "error" | "log">;

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  exit?: Exit;
  logger?: Logger;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function createGracefulShutdown(server: Server, options: GracefulShutdownOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const exit = options.exit ?? process.exit.bind(process);
  const logger = options.logger ?? console;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let shuttingDown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`[Shutdown] Received ${signal}; closing HTTP server`);

    timer = setTimeoutFn(() => {
      logger.error(`[Shutdown] Grace period expired after ${timeoutMs}ms`);
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    server.close(error => {
      if (timer) clearTimeoutFn(timer);
      if (error) {
        logger.error("[Shutdown] Failed to close HTTP server", error);
        exit(1);
        return;
      }
      logger.log("[Shutdown] HTTP server closed cleanly");
      exit(0);
    });
  };
}

export function installGracefulShutdown(server: Server, options: GracefulShutdownOptions = {}) {
  const shutdown = createGracefulShutdown(server, options);
  const onSigterm = () => shutdown("SIGTERM");
  const onSigint = () => shutdown("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  return () => {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
  };
}
