import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { addMessage, createConversation, deleteApiKey, deleteConversation, getApiKey, getConversation, getUserPreferredModel, listConversations, listMessages, saveApiKey, updateConversation, updateUserPreferredModel } from "./db";
import { applyQuickCommand, buildSystemPrompt, decryptSecret, encryptSecret, fallbackModels, MODEL_CATALOG, modelInfo, streamModel, summarizeConversation, type ModelId, type Provider } from "./ai";

const providerSchema = z.enum(["google", "groq", "huggingface"]);
const modelSchema = z.enum(["gemini-2.5-flash", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"]);

async function resolveKey(userId: number, model: string) {
  const provider = modelInfo(model).provider;
  const record = await getApiKey(userId, provider);
  return { provider, key: record ? decryptSecret(record.encryptedKey) : undefined };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  models: publicProcedure.query(() => MODEL_CATALOG),
  conversations: router({
    list: protectedProcedure.query(({ ctx }) => listConversations(ctx.user.id)),
    create: protectedProcedure.input(z.object({ model: modelSchema.optional(), title: z.string().max(255).optional() })).mutation(({ ctx, input }) => createConversation(ctx.user.id, input.model, input.title)),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const conversation = await getConversation(ctx.user.id, input.id);
      if (!conversation) return null;
      return { conversation, messages: await listMessages(input.id) };
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await deleteConversation(ctx.user.id, input.id); return { success: true }; }),
    setModel: protectedProcedure.input(z.object({ id: z.number().int().positive(), model: modelSchema })).mutation(async ({ ctx, input }) => {
      const conversation = await getConversation(ctx.user.id, input.id);
      if (!conversation) throw new Error("Conversation not found");
      await updateConversation(input.id, { model: input.model });
      return { success: true };
    }),
  }),
  settings: router({
    preferences: protectedProcedure.query(async ({ ctx }) => ({ preferredModel: await getUserPreferredModel(ctx.user.id) })),
    setPreferredModel: protectedProcedure.input(z.object({ model: modelSchema })).mutation(async ({ ctx, input }) => { await updateUserPreferredModel(ctx.user.id, input.model); return { success: true }; }),
    status: protectedProcedure.query(async ({ ctx }) => {
      const providers: Provider[] = ["google", "groq", "huggingface"];
      const entries = await Promise.all(providers.map(async provider => ({ provider, configured: Boolean(await getApiKey(ctx.user.id, provider)) })));
      return entries;
    }),
    saveKey: protectedProcedure.input(z.object({ provider: providerSchema, key: z.string().min(10).max(500) })).mutation(async ({ ctx, input }) => {
      await saveApiKey(ctx.user.id, input.provider, encryptSecret(input.key.trim()));
      return { success: true };
    }),
    deleteKey: protectedProcedure.input(z.object({ provider: providerSchema })).mutation(async ({ ctx, input }) => { await deleteApiKey(ctx.user.id, input.provider); return { success: true }; }),
  }),
  ai: router({
    chat: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), content: z.string().min(1).max(20000), model: modelSchema.optional() })).mutation(async ({ ctx, input }) => {
      const conversation = await getConversation(ctx.user.id, input.conversationId);
      if (!conversation) throw new Error("Conversation not found");
      const selectedModel = input.model || conversation.model as ModelId;
      const parsed = applyQuickCommand(input.content);
      const history = await listMessages(input.conversationId);
      await addMessage(input.conversationId, "user", input.content);
      const messages = [
        { role: "system" as const, content: buildSystemPrompt(parsed.command, parsed.instruction) },
        ...(conversation.summary ? [{ role: "system" as const, content: `ملخص سابق للمحادثة:\n${conversation.summary}` }] : []),
        ...history.slice(-24).map(message => ({ role: message.role as "user" | "assistant" | "system", content: message.content })),
        { role: "user" as const, content: parsed.cleanInput || input.content },
      ];
      let answer = "";
      let usedModel = selectedModel;
      for (const candidate of fallbackModels(selectedModel)) {
        const candidateKey = await getApiKey(ctx.user.id, modelInfo(candidate).provider);
        if (!candidateKey) continue;
        try { answer = await streamModel({ model: candidate, apiKey: decryptSecret(candidateKey.encryptedKey), messages }); usedModel = candidate; break; } catch { /* try the next configured provider */ }
      }
      if (!answer) {
        const response = await invokeLLM({ model: selectedModel, messages });
        answer = typeof response.choices[0]?.message.content === "string" ? response.choices[0].message.content : "";
      }
      await addMessage(input.conversationId, "assistant", answer);
      const completeHistory = [...history, { role: "user" as const, content: input.content }, { role: "assistant" as const, content: answer }];
      const update: { title?: string; model?: string; summary?: string } = { title: conversation.title === "محادثة جديدة" ? input.content.slice(0, 60) : undefined, model: usedModel };
      const summaryKey = await getApiKey(ctx.user.id, modelInfo(usedModel).provider);
      if (completeHistory.length >= 20 && summaryKey) update.summary = await summarizeConversation({ model: usedModel, apiKey: decryptSecret(summaryKey.encryptedKey), messages: completeHistory });
      await updateConversation(input.conversationId, update);
      return { answer, command: parsed.command, model: usedModel };
    }),
  }),
});

export type AppRouter = typeof appRouter;
