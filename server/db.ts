import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { apiKeys, conversations, InsertUser, messages, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export function filterOwnedConversations<T extends { userId: number }>(userId: number, rows: T[]) {
  return rows.filter(row => row.userId === userId);
}

export function resolvePreferredModel(value: string | null | undefined, fallback = "gemini-2.5-flash") {
  return value || fallback;
}

export async function listConversations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
  return filterOwnedConversations(userId, rows);
}

export async function createConversation(userId: number, model = "gemini-2.5-flash", title = "محادثة جديدة") {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(conversations).values({ userId, model, title });
  return Number(result[0].insertId);
}

export async function getConversation(userId: number, conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
  return rows[0];
}

export function canMutateConversation(userId: number, ownerId: number) {
  return userId === ownerId;
}

export async function deleteOwnedConversation(
  userId: number,
  conversationId: number,
  deps: {
    find: () => Promise<{ id: number; userId: number } | undefined>;
    deleteMessages: () => Promise<void>;
    deleteConversation: () => Promise<void>;
  },
) {
  const owned = await deps.find();
  if (!owned || !canMutateConversation(userId, owned.userId)) return false;
  await deps.deleteMessages();
  await deps.deleteConversation();
  return true;
}

export async function deleteConversation(userId: number, conversationId: number) {
  const db = await getDb();
  if (!db) return false;
  return deleteOwnedConversation(userId, conversationId, {
    find: () => getConversation(userId, conversationId),
    deleteMessages: async () => { await db.delete(messages).where(eq(messages.conversationId, conversationId)); },
    deleteConversation: async () => { await db.delete(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))); },
  });
}

export async function listMessages(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
}

export async function addMessage(conversationId: number, role: "user" | "assistant" | "system", content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(messages).values({ conversationId, role, content });
}

export async function updateConversation(conversationId: number, values: { title?: string; model?: string; summary?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(conversations).set(values).where(eq(conversations.id, conversationId));
}

export async function getApiKey(userId: number, provider: "google" | "groq" | "huggingface") {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider))).limit(1);
  return rows[0];
}

export async function saveApiKey(userId: number, provider: "google" | "groq" | "huggingface", encryptedKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getApiKey(userId, provider);
  if (existing) {
    await db.update(apiKeys).set({ encryptedKey }).where(eq(apiKeys.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(apiKeys).values({ userId, provider, encryptedKey });
  return Number(result[0].insertId);
}

export async function updateUserPreferredModel(userId: number, preferredModel: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ preferredModel }).where(eq(users.id, userId));
}

export async function getUserPreferredModel(userId: number) {
  const db = await getDb();
  if (!db) return resolvePreferredModel(undefined);
  const rows = await db.select({ preferredModel: users.preferredModel }).from(users).where(eq(users.id, userId)).limit(1);
  return resolvePreferredModel(rows[0]?.preferredModel);
}

export async function deleteApiKey(userId: number, provider: "google" | "groq" | "huggingface") {
  const db = await getDb();
  if (!db) return;
  await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)));
}
