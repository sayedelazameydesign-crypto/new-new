import { describe, expect, it, vi } from "vitest";
import { registerHealthRoute } from "./health";

describe("health route", () => {
  it("registers GET /api/health and returns the exact health payload", () => {
    const get = vi.fn();
    registerHealthRoute({ get } as never);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/health", expect.any(Function));

    const handler = get.mock.calls[0][1] as (_req: unknown, res: { json: (payload: unknown) => void }) => void;
    const json = vi.fn();
    handler({}, { json });
    expect(json).toHaveBeenCalledWith({ ok: true });
  });
});
