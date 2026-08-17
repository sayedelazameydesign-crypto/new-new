import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user-${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "test",
      role: "user",
      preferredModel: "gemini-2.5-flash",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("conversation and settings procedures", () => {
  const testUserId = () => 1_000_000_000 + Math.floor(Math.random() * 100_000_000);

  it("returns an isolated empty conversation list for fresh test users", async () => {
    const first = appRouter.createCaller(context(testUserId()));
    const second = appRouter.createCaller(context(testUserId()));
    expect(await first.conversations.list()).toEqual([]);
    expect(await second.conversations.list()).toEqual([]);
  });

  it("reads and persists the preferred model contract for a user", async () => {
    const caller = appRouter.createCaller(context(testUserId()));
    expect(await caller.settings.preferences()).toEqual({ preferredModel: "gemini-2.5-flash" });
    expect(await caller.settings.setPreferredModel({ model: "llama-3.3-70b-versatile" })).toEqual({ success: true });
  });
});
