import { afterEach, describe, expect, it, vi } from "vitest";
import { streamModel } from "./ai";

describe("authenticated SSE model contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams provider SSE tokens and returns the combined answer", async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"مرحبا "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"بالعالم"}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const encoder = new TextEncoder();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(sse.slice(0, 54)));
            controller.enqueue(encoder.encode(sse.slice(54)));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const tokens: string[] = [];

    const answer = await streamModel({
      model: "gemini-2.5-flash",
      apiKey: "synthetic-test-key",
      messages: [{ role: "user", content: "قل مرحبًا" }],
      onToken: token => tokens.push(token),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("streamGenerateContent");
    expect(answer).toBe("مرحبا بالعالم");
    expect(tokens).toEqual(["مرحبا ", "بالعالم"]);
  });
});
