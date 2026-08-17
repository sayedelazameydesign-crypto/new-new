import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { getApiKey, getConversation, listMessages, addMessage, updateConversation } from "../db";
import { applyQuickCommand, buildSystemPrompt, chooseFirstWorking, decryptSecret, fallbackModels, modelInfo, streamModel, summarizeConversation, type ModelId } from "../ai";
import { installGracefulShutdown } from "./gracefulShutdown";
import { registerHealthRoute } from "./health";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  installGracefulShutdown(server);
  registerHealthRoute(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/ai/stream", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const { conversationId, content, model } = req.body as { conversationId?: number; content?: string; model?: ModelId };
      if (!user || !conversationId || !content?.trim()) return res.status(400).json({ error: "بيانات المحادثة غير مكتملة" });
      const conversation = await getConversation(user.id, Number(conversationId));
      if (!conversation) return res.status(404).json({ error: "المحادثة غير موجودة" });
      const selectedModel = model || conversation.model as ModelId;
      const parsed = applyQuickCommand(content);
      const history = await listMessages(conversation.id);
      await addMessage(conversation.id, "user", content);
      const messages = [
        { role: "system" as const, content: buildSystemPrompt(parsed.command, parsed.instruction) },
        ...(conversation.summary ? [{ role: "system" as const, content: `ملخص سابق للمحادثة:\n${conversation.summary}` }] : []),
        ...history.slice(-24).map(message => ({ role: message.role as "user" | "assistant" | "system", content: message.content })),
        { role: "user" as const, content: parsed.cleanInput || content },
      ];
      res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.flushHeaders();
      let answer = "";
      const selected = await chooseFirstWorking(fallbackModels(selectedModel), async candidate => Boolean(await getApiKey(user.id, modelInfo(candidate).provider)), async candidate => {
        const record = await getApiKey(user.id, modelInfo(candidate).provider);
        if (!record) throw new Error("provider is not configured");
        return streamModel({ model: candidate, apiKey: decryptSecret(record.encryptedKey), messages, onToken: token => { answer += token; res.write(`data: ${JSON.stringify({ token })}\\n\\n`); } });
      });
      if (!selected) { res.write(`data: ${JSON.stringify({ error: "لم يتم العثور على مزود API مهيأ أو فشل جميع المزودين" })}\\n\\n`); res.end(); return; }
      const usedModel = selected.model;
      await addMessage(conversation.id, "assistant", answer);
      const completeHistory = [...history, { role: "user" as const, content }, { role: "assistant" as const, content: answer }];
      const update: { title?: string; model?: string; summary?: string } = { title: conversation.title === "محادثة جديدة" ? content.slice(0, 60) : undefined, model: usedModel };
      const summaryRecord = await getApiKey(user.id, modelInfo(usedModel).provider);
      if (completeHistory.length >= 20 && summaryRecord) update.summary = await summarizeConversation({ model: usedModel, apiKey: decryptSecret(summaryRecord.encryptedKey), messages: completeHistory });
      await updateConversation(conversation.id, update);
      res.write(`data: ${JSON.stringify({ done: true, command: parsed.command, model: usedModel })}\\n\\n`);
      res.end();
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error instanceof Error ? error.message : "تعذر تنفيذ الطلب" });
      else { res.write(`data: ${JSON.stringify({ error: "تعذر إكمال البث" })}\\n\\n`); res.end(); }
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
