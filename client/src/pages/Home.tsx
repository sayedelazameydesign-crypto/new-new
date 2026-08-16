import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Streamdown } from "streamdown";
import { trpc } from "@/lib/trpc";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Command, Loader2, Menu, MessageSquare, Plus, Send, Settings, Sparkles, Trash2, X, Zap } from "lucide-react";

type ModelId = "gemini-2.5-flash" | "llama-3.3-70b-versatile" | "mixtral-8x7b-32768";
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const models: Array<{ id: ModelId; label: string; provider: string; tone: string }> = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google", tone: "cyan" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq", tone: "violet" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", provider: "Groq", tone: "rose" },
];
const commands = ["/شرح", "/تصحيح", "/تحسين", "/اختبار", "/توثيق", "/مراجعة"];

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const conversations = trpc.conversations.list.useQuery(undefined, { enabled: Boolean(user) });
  const createConversation = trpc.conversations.create.useMutation({ onSuccess: () => utils.conversations.list.invalidate() });
  const deleteConversation = trpc.conversations.delete.useMutation({ onSuccess: () => { utils.conversations.list.invalidate(); setActiveId(null); } });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [model, setModel] = useState<ModelId>("gemini-2.5-flash");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiProvider, setApiProvider] = useState<"google" | "groq" | "huggingface">("google");
  const [apiKey, setApiKey] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const saveKey = trpc.settings.saveKey.useMutation({ onSuccess: () => { setApiKey(""); setSavedNotice("تم حفظ المفتاح مشفّرًا"); setTimeout(() => setSavedNotice(""), 2500); utils.settings.status.invalidate(); } });
  const settingsStatus = trpc.settings.status.useQuery(undefined, { enabled: settingsOpen && Boolean(user) });
  const preferences = trpc.settings.preferences.useQuery(undefined, { enabled: Boolean(user) });
  const setPreferredModel = trpc.settings.setPreferredModel.useMutation();
  const activeConversation = useMemo(() => conversations.data?.find(item => item.id === activeId), [conversations.data, activeId]);
  const conversationQuery = trpc.conversations.get.useQuery({ id: activeId || 0 }, { enabled: Boolean(activeId) });

  useEffect(() => {
    if (!activeId && conversations.data?.[0]) setActiveId(conversations.data[0].id);
  }, [conversations.data, activeId]);
  useEffect(() => {
    if (preferences.data?.preferredModel) setModel(preferences.data.preferredModel as ModelId);
  }, [preferences.data?.preferredModel]);
  useEffect(() => {
    if (conversationQuery.data) {
      setMessages(conversationQuery.data.messages.map(item => ({ role: item.role, content: item.content })));
      setModel(conversationQuery.data.conversation.model as ModelId);
    }
  }, [conversationQuery.data]);
  useEffect(() => { viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" }); }, [messages, isStreaming]);

  const startConversation = async () => {
    const result = await createConversation.mutateAsync({ model });
    setActiveId(result);
    setMessages([]);
    setMobileOpen(false);
  };
  const sendMessage = async () => {
    const content = input.trim();
    if (!content || !activeId || isStreaming) return;
    setInput("");
    setLastFailed(null);
    setMessages(previous => [...previous, { role: "user", content }, { role: "assistant", content: "" }]);
    setIsStreaming(true);
    try {
      const response = await fetch("/api/ai/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: activeId, content, model }) });
      if (!response.ok) throw new Error((await response.json()).error || "تعذر الاتصال بالمزود");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("البث غير متاح");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find(item => item.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as { token?: string; error?: string };
          if (payload.error) throw new Error(payload.error);
          if (payload.token) setMessages(previous => { const next = [...previous]; next[next.length - 1] = { role: "assistant", content: `${next[next.length - 1]?.content || ""}${payload.token}` }; return next; });
        }
      }
      utils.conversations.list.invalidate();
    } catch (error) {
      setLastFailed(content);
      setMessages(previous => { const next = [...previous]; next[next.length - 1] = { role: "assistant", content: `**تعذر إكمال الطلب**\n\n${error instanceof Error ? error.message : "حدث خطأ غير متوقع"}` }; return next; });
    } finally { setIsStreaming(false); }
  };

  if (authLoading || !user) return <div className="min-h-screen bg-[#080b12] text-slate-200 grid place-items-center"><Loader2 className="animate-spin" /></div>;
  return (
    <div dir="rtl" className="min-h-screen bg-[#080b12] text-slate-100 font-sans selection:bg-cyan-300/30">
      <div className="technical-grid pointer-events-none fixed inset-0 opacity-40" />
      <div className="relative flex min-h-screen overflow-hidden">
        <aside className={`${mobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"} fixed inset-y-0 right-0 z-30 flex w-[290px] flex-col border-l border-white/10 bg-[#0b0f18]/95 p-4 backdrop-blur-xl transition-transform md:relative md:translate-x-0`}>
          <div className="mb-7 flex items-center justify-between px-2"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Sparkles size={19} /></div><div><div className="font-semibold tracking-tight">مِحور</div><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">agent workspace</div></div></div><button className="md:hidden" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
          <Button onClick={startConversation} className="mb-5 h-11 justify-center gap-2 rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"><Plus size={17} /> محادثة جديدة</Button>
          <div className="mb-3 flex items-center justify-between px-2"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">المحادثات</span><span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-500">{conversations.data?.length || 0}</span></div>
          <ScrollArea className="min-h-0 flex-1"><div className="space-y-1">{conversations.data?.map(item => <button key={item.id} onClick={() => { setActiveId(item.id); setMobileOpen(false); }} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right transition ${activeId === item.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}><MessageSquare size={15} className={activeId === item.id ? "text-cyan-300" : "text-slate-600"} /><span className="min-w-0 flex-1 truncate text-sm">{item.title}</span><span onClick={event => { event.stopPropagation(); deleteConversation.mutate({ id: item.id }); }} className="hidden text-slate-600 hover:text-rose-300 group-hover:block"><Trash2 size={14} /></span></button>)}</div></ScrollArea>
          <div className="mt-4 border-t border-white/10 pt-4"><button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400 hover:bg-white/5 hover:text-white"><Settings size={16} /> إعدادات المزودين</button><div className="mt-4 flex items-center gap-3 px-3"><div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-violet-400 text-xs font-bold text-slate-950">{user.name?.slice(0, 1) || "م"}</div><div className="min-w-0"><div className="truncate text-xs text-slate-200">{user.name || "مستخدم"}</div><div className="font-mono text-[10px] text-slate-600">session.active</div></div></div></div>
        </aside>
        {mobileOpen && <button aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-20 bg-black/60 md:hidden" />}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[76px] items-center justify-between border-b border-white/10 px-5 md:px-9"><div className="flex items-center gap-3"><button className="md:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div><div className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-300/70">/ workspace / conversation</div><h1 className="mt-1 text-lg font-semibold tracking-tight">المختبر التفاعلي</h1></div></div><div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-[11px] text-emerald-200 sm:flex"><span className="size-1.5 rounded-full bg-emerald-300" /> النظام جاهز</div><div className="relative"><select value={model} onChange={event => { const nextModel = event.target.value as ModelId; setModel(nextModel); setPreferredModel.mutate({ model: nextModel }); }} className="h-9 appearance-none rounded-lg border border-white/10 bg-white/5 py-1 pl-8 pr-3 text-xs text-slate-200 outline-none hover:border-cyan-300/30">{models.map(item => <option key={item.id} value={item.id} className="bg-[#101622]">{item.label}</option>)}</select><ChevronDown size={13} className="pointer-events-none absolute left-2.5 top-3 text-slate-500" /></div></div></header>
          <section className="relative flex min-h-0 flex-1 flex-col"><div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-[12%]">{!activeId || messages.length === 0 ? <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center"><div className="wire-orbit mb-8 grid size-24 place-items-center rounded-[28px] border border-cyan-300/30 bg-cyan-300/[0.06] text-cyan-200"><Bot size={36} strokeWidth={1.2} /></div><div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/70">arabic intelligence / v1</div><h2 className="mt-4 text-4xl font-black tracking-[-0.04em] text-white md:text-6xl">فكّر. ابنِ. <span className="text-cyan-300">كرّر.</span></h2><p className="mt-5 max-w-xl text-sm leading-7 text-slate-400">مساحة عمل عربية تضع النماذج والأدوات والذاكرة في مسار واحد. ابدأ بسؤال تقني أو استخدم أحد الأوامر السريعة.</p><div className="mt-9 grid w-full max-w-2xl grid-cols-2 gap-2 md:grid-cols-3">{commands.map(command => <button key={command} onClick={() => setInput(`${command} `)} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-right font-mono text-xs text-slate-300 transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-cyan-300/[0.06]"><Command size={13} className="mb-2 text-cyan-300" />{command}</button>)}</div>{!activeId && <Button onClick={startConversation} variant="outline" className="mt-8 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10">ابدأ محادثة <Zap size={15} className="mr-2 text-cyan-300" /></Button>}</div> : <div className="mx-auto max-w-3xl space-y-8">{messages.map((message, index) => <div key={`${index}-${message.role}`} className={`flex gap-4 ${message.role === "user" ? "justify-start" : "justify-end"}`}><div className={`max-w-[88%] ${message.role === "user" ? "order-2" : "order-1"}`}><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">{message.role === "assistant" ? <><Sparkles size={12} className="text-cyan-300" /> محور / assistant</> : <>you / user</>}</div><div className={`rounded-2xl border px-5 py-4 text-sm leading-7 ${message.role === "user" ? "border-cyan-300/20 bg-cyan-300/[0.08] text-slate-100" : "border-white/10 bg-white/[0.045] text-slate-200"}`}>{message.role === "assistant" ? <div className="prose prose-invert prose-sm max-w-none"><Streamdown>{message.content || "..."}</Streamdown></div> : <p className="whitespace-pre-wrap">{message.content}</p>}</div></div></div>)}</div>}</div>
            <div className="mx-auto w-full max-w-3xl px-4 pb-5 md:px-0"><div className="rounded-2xl border border-white/15 bg-[#111722]/90 p-2 shadow-2xl shadow-cyan-950/10 backdrop-blur-xl"><Textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={activeId ? "اكتب رسالتك… استخدم / لإظهار الأوامر" : "أنشئ محادثة جديدة للبدء"} disabled={!activeId || isStreaming} className="min-h-[58px] resize-none border-0 bg-transparent px-3 py-3 text-right text-sm leading-7 shadow-none focus-visible:ring-0" /><div className="flex items-center justify-between px-2 pb-1"><span className="font-mono text-[10px] text-slate-600">Enter للإرسال · Shift + Enter لسطر جديد</span><Button onClick={() => void sendMessage()} disabled={!input.trim() || !activeId || isStreaming} size="icon" className="size-9 rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">{isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</Button></div></div>{lastFailed && <div className="mt-3 flex items-center justify-center gap-3 text-xs text-rose-200"><span>تعذر إرسال الرسالة.</span><button onClick={() => { setInput(lastFailed); setLastFailed(null); }} className="rounded-lg border border-rose-300/25 px-3 py-1.5 hover:bg-rose-300/10">إعادة المحاولة</button></div>}<div className="mt-3 flex items-center justify-center gap-2 font-mono text-[10px] text-slate-600"><Check size={12} className="text-emerald-400" /> مفاتيحك تُشفّر قبل الحفظ · لا تُعرض في الواجهة</div></div>
          </section>
        </main>
      </div>
      {settingsOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#101621] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-widest text-cyan-300">secure provider vault</div><h3 className="mt-2 text-xl font-bold">إعدادات النماذج</h3><p className="mt-2 text-sm leading-6 text-slate-400">أدخل مفتاحك الشخصي. يُشفّر على الخادم ولا يُعاد إرساله إلى المتصفح.</p></div><button onClick={() => setSettingsOpen(false)}><X size={18} className="text-slate-500" /></button></div><div className="mt-6 space-y-4"><div><label className="mb-2 block text-xs text-slate-400">النموذج المفضل</label><select value={model} onChange={event => { const nextModel = event.target.value as ModelId; setModel(nextModel); setPreferredModel.mutate({ model: nextModel }); }} className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-200 outline-none">{models.map(item => <option key={item.id} value={item.id} className="bg-[#101622]">{item.label} — {item.provider}</option>)}</select></div><div className="grid grid-cols-3 gap-2">{(["google", "groq", "huggingface"] as const).map(provider => <button key={provider} onClick={() => setApiProvider(provider)} className={`rounded-lg border px-2 py-2 text-xs ${apiProvider === provider ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-200" : "border-white/10 text-slate-400"}`}>{provider}</button>)}</div><div><label className="mb-2 block text-xs text-slate-400">مفتاح {apiProvider}</label><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="يُحفظ مشفّرًا" className="border-white/10 bg-white/5" /></div><Button onClick={() => saveKey.mutate({ provider: apiProvider, key: apiKey })} disabled={apiKey.length < 10 || saveKey.isPending} className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200">{saveKey.isPending ? <Loader2 className="animate-spin" /> : "حفظ المفتاح بأمان"}</Button>{savedNotice && <div className="text-center text-xs text-emerald-300">{savedNotice}</div>}<div className="border-t border-white/10 pt-4"><div className="mb-3 text-xs text-slate-500">حالة المزودين</div>{settingsStatus.data?.map(item => <div key={item.provider} className="flex items-center justify-between py-1.5 text-xs"><span className="text-slate-300">{item.provider}</span><span className={item.configured ? "text-emerald-300" : "text-slate-600"}>{item.configured ? "مهيأ" : "غير مهيأ"}</span></div>)}</div></div></div></div>}
    </div>
  );
}
