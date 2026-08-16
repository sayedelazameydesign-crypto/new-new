import { describe, expect, it } from "vitest";
import { canMutateConversation, deleteOwnedConversation, filterOwnedConversations, resolvePreferredModel } from "./db";

describe("conversation ownership", () => {
  it("allows the owner to mutate a conversation", () => {
    expect(canMutateConversation(7, 7)).toBe(true);
  });

  it("rejects a different user before message deletion", () => {
    expect(canMutateConversation(7, 8)).toBe(false);
  });

  it("isolates real conversation rows between users", () => {
    const rows = [{ id: 1, userId: 7 }, { id: 2, userId: 8 }, { id: 3, userId: 7 }];
    expect(filterOwnedConversations(7, rows)).toEqual([{ id: 1, userId: 7 }, { id: 3, userId: 7 }]);
    expect(filterOwnedConversations(8, rows)).toEqual([{ id: 2, userId: 8 }]);
  });

  it("round-trips a preferred model value with a safe default", () => {
    const saved = "llama-3.3-70b-versatile";
    expect(resolvePreferredModel(saved)).toBe(saved);
    expect(resolvePreferredModel(null)).toBe("gemini-2.5-flash");
  });

  it("does not delete messages or the conversation for a foreign owner", async () => {
    let messagesDeleted = false;
    let conversationDeleted = false;
    const result = await deleteOwnedConversation(7, 42, {
      find: async () => ({ id: 42, userId: 8 }),
      deleteMessages: async () => { messagesDeleted = true; },
      deleteConversation: async () => { conversationDeleted = true; },
    });
    expect(result).toBe(false);
    expect(messagesDeleted).toBe(false);
    expect(conversationDeleted).toBe(false);
  });
});
