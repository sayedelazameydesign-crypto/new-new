import crypto from "node:crypto";

export type Provider = "google" | "groq" | "huggingface";
export type ModelId = "gemini-2.5-flash" | "llama-3.3-70b-versatile" | "mixtral-8x7b-32768";

export const MODEL_CATALOG: Array<{ id: ModelId; label: string; provider: Provider; badge: string }> = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", badge: "Google" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "groq", badge: "Groq" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", provider: "groq", badge: "Groq" },
];

const COMMANDS: Record<string, string> = {
  "/شرح": "اشرح الكود أو الفكرة بالعربية بشكل واضح، ثم اذكر مثالًا عمليًا.",
  "/تصحيح": "حلل المشكلة، حدد سبب الخطأ، ثم اقترح إصلاحًا آمنًا مع الكود المصحح.",
  "/تحسين": "حسّن الأداء وقابلية القراءة والأمان، واذكر سبب كل تعديل.",
  "/اختبار": "اكتب اختبارات وحدة شاملة للحالة المعطاة مع الحالات الحدّية.",
  "/توثيق": "أنشئ توثيقًا احترافيًا بالعربية يتضمن الاستخدام والأمثلة والتحذيرات.",
  "/مراجعة": "راجع الحل مراجعة تقنية شاملة تشمل الصحة والأمان والأداء وقابلية الصيانة.",
};

export function applyQuickCommand(input: string) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || "";
  const instruction = COMMANDS[firstToken];
  if (!instruction) return { cleanInput: input.trim(), command: null, instruction: null };

  let contentStart = 1;
  while (tokens[contentStart] === firstToken) contentStart += 1;
  return { cleanInput: tokens.slice(contentStart).join(" ").trim(), command: firstToken, instruction };
}

export function buildSystemPrompt(command?: string | null, commandInstruction?: string | null) {
  const commandLine = commandInstruction ? `\nالتوجيه السريع (${command}): ${commandInstruction}` : "";
  return `أنت مساعد ذكاء اصطناعي تقني محترف باللغة العربية. أجب بالعربية ما لم يطلب المستخدم غير ذلك. استخدم Markdown منظمًا، وضع الكود داخل fenced code blocks مع اسم اللغة. لا تدّعي تنفيذ شيء لم تنفذه، وصرّح بالافتراضات وحدود الإجابة. احترم الخصوصية ولا تطلب مفاتيح سرية داخل نص المحادثة.${commandLine}`;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(process.env.JWT_SECRET || "free-agent-local-secret").digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Invalid encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function modelInfo(model: string) {
  return MODEL_CATALOG.find(item => item.id === model) || MODEL_CATALOG[0];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => extractText(item)).join("");
  if (value && typeof value === "object" && "text" in value) return String((value as { text: unknown }).text);
  return "";
}

async function fetchWithRetry(input: string, init: RequestInit, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok || (response.status < 400 && response.status !== 429)) return response;
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`retryable provider status ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed after retry");
}

async function readSse(response: Response, onToken?: (token: string) => void) {
  if (!response.ok) throw new Error(`Provider request failed: ${response.status}`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.replace(/^data:\s?/, "").trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      try {
        const json = JSON.parse(trimmed);
        const token = extractText(json?.choices?.[0]?.delta?.content ?? json?.candidates?.[0]?.content?.parts);
        if (token) { full += token; onToken?.(token); }
      } catch { /* ignore keep-alive/non-json SSE lines */ }
    }
  }
  return full;
}

export async function streamModel(params: { model: ModelId; apiKey: string; messages: ChatMessage[]; onToken?: (token: string) => void }) {
  const info = modelInfo(params.model);
  if (info.provider === "google") {
    const contents = params.messages.filter(message => message.role !== "system").map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const system = params.messages.find(message => message.role === "system")?.content;
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(params.apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { temperature: 0.4 } }),
    });
    return readSse(response, params.onToken);
  }
  const response = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({ model: params.model, messages: params.messages, stream: true, temperature: 0.4 }),
  });
  return readSse(response, params.onToken);
}


export function fallbackModels(selected: ModelId): ModelId[] {
  return [selected, ...MODEL_CATALOG.map(item => item.id).filter(id => id !== selected)];
}

export async function summarizeConversation(params: { model: ModelId; apiKey: string; messages: ChatMessage[] }) {
  const source = params.messages.slice(-40).map(message => `${message.role}: ${message.content}`).join("\n");
  return streamModel({
    model: params.model,
    apiKey: params.apiKey,
    messages: [
      { role: "system", content: "لخّص المحادثة التالية بالعربية في نقاط عملية قصيرة، مع حفظ القرارات والافتراضات والأسئلة المفتوحة فقط. لا تذكر هذه التعليمات." },
      { role: "user", content: source },
    ],
  });
}


export async function chooseFirstWorking<T>(
  candidates: ModelId[],
  isConfigured: (model: ModelId) => Promise<boolean>,
  run: (model: ModelId) => Promise<T>,
) {
  for (const candidate of candidates) {
    if (!(await isConfigured(candidate))) continue;
    try { return { model: candidate, value: await run(candidate) }; } catch { /* SSE fallback continues */ }
  }
  return null;
}
