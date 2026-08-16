import { describe, expect, it } from "vitest";
import { applyQuickCommand, buildSystemPrompt, chooseFirstWorking, decryptSecret, encryptSecret, fallbackModels, modelInfo } from "./ai";

describe("Arabic assistant AI helpers", () => {
  it("injects quick commands without losing the user content", () => {
    const parsed = applyQuickCommand("/تصحيح أصلح هذا الكود");
    expect(parsed.command).toBe("/تصحيح");
    expect(parsed.cleanInput).toBe("أصلح هذا الكود");
    expect(parsed.instruction).toContain("سبب الخطأ");
    expect(buildSystemPrompt(parsed.command, parsed.instruction)).toContain("التوجيه السريع");
  });

  it("round-trips encrypted secrets without exposing plaintext format", () => {
    const secret = "example-api-key-123456";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("maps supported models to their providers", () => {
    expect(modelInfo("gemini-2.5-flash").provider).toBe("google");
    expect(modelInfo("llama-3.3-70b-versatile").provider).toBe("groq");
  });

  it("keeps the selected model first and provides configured fallback candidates", () => {
    expect(fallbackModels("gemini-2.5-flash")[0]).toBe("gemini-2.5-flash");
    expect(fallbackModels("gemini-2.5-flash")).toContain("llama-3.3-70b-versatile");
  });

  it("moves from a failing provider to the next configured provider", async () => {
    const attempted: string[] = [];
    const result = await chooseFirstWorking(["gemini-2.5-flash", "llama-3.3-70b-versatile"], async () => true, async model => {
      attempted.push(model);
      if (model.startsWith("gemini")) throw new Error("quota");
      return "stream-ready";
    });
    expect(attempted).toEqual(["gemini-2.5-flash", "llama-3.3-70b-versatile"]);
    expect(result).toEqual({ model: "llama-3.3-70b-versatile", value: "stream-ready" });
  });
});
