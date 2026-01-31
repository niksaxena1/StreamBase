"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Role = "user" | "assistant";

type Envelope = {
  route: { pathname: string; search: Record<string, string> };
  selected: { playlist_key: string | null; artist_id: string | null; isrc: string | null; collector: string | null };
  ui: Record<string, unknown>;
};

type UiMessage = {
  id: string;
  role: Role;
  content: string;
  meta?: any;
};

type QueueItem = { id: string; content: string };

function uuid() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function toRecord(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

function buildEnvelope(pathname: string, sp: URLSearchParams): Envelope {
  const search = toRecord(sp);
  return {
    route: { pathname, search },
    selected: {
      playlist_key: search.playlist_key ?? null,
      artist_id: search.artist_id ?? null,
      isrc: search.isrc ?? null,
      collector: search.collector ?? null,
    },
    ui: {
      last_playlist_key: safeGet("sb:last_playlist_key"),
      last_artist_id: safeGet("sb:last_artist_id"),
      last_collector: safeGet("sb:last_collector"),
    },
  };
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function SAIWidget() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const envelope = useMemo(
    () => buildEnvelope(pathname, new URLSearchParams(searchParams?.toString() ?? "")),
    [pathname, searchParams],
  );

  useEffect(() => {
    // Auto-create conversation on first open.
    if (!open) return;
    if (conversationId) return;
    void newChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // Auto-scroll to bottom on new content
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    // Auto-send queued message when streaming ends.
    if (isStreaming) return;
    if (!open) return;
    if (!conversationId) return;
    if (queue.length === 0) return;
    const next = queue[0];
    setQueue((q) => q.slice(1));
    void sendMessage(next.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  async function newChat(): Promise<string | null> {
    setIsStreaming(false);
    setQueue([]);
    setMessages([]);
    const res = await fetch("/api/sai/new", { method: "POST" });
    if (!res.ok) {
      setMessages([
        { id: uuid(), role: "assistant", content: "Failed to create a new chat (are you logged in?)." },
      ]);
      return null;
    }
    const json = (await res.json()) as { conversationId?: string };
    const cid = json.conversationId ?? null;
    setConversationId(cid);
    return cid;
  }

  async function sendMessage(text: string) {
    const t = text.trim();
    if (!t) return;
    let cid = conversationId ?? null;
    if (!cid) cid = await newChat();
    if (!cid) return;

    const userMsg: UiMessage = { id: uuid(), role: "user", content: t };
    setMessages((m) => [...m, userMsg]);

    const assistantId = uuid();
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      async function doFetch(convoId: string) {
        return await fetch("/api/sai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: convoId, message: t, envelope }),
        });
      }

      let resp = await doFetch(cid);

      // If the server says the conversation was deleted (410), auto-create a new one and retry once.
      if (resp.status === 410) {
        const fresh = await newChat();
        if (fresh) {
          cid = fresh;
          resp = await doFetch(fresh);
        }
      }

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "delta" && typeof ev.text === "string") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content ?? "") + ev.text } : m)),
            );
          } else if (ev.type === "meta") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, meta: { ...(m.meta ?? {}), ...(ev.meta ?? {}) } } : m)),
            );
          } else if (ev.type === "done") {
            // ensure final
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: String(ev.message?.content ?? m.content), meta: ev.message?.meta ?? m.meta }
                  : m,
              ),
            );
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${e?.message ?? "unknown"}` } : m)),
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function onSubmit() {
    if (!input.trim()) return;
    if (isStreaming) {
      const item = { id: uuid(), content: input.trim() };
      setQueue((q) => [...q, item]);
      setInput("");
      return;
    }
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  function moveQueue(id: string, dir: -1 | 1) {
    setQueue((q) => {
      const idx = q.findIndex((x) => x.id === id);
      if (idx < 0) return q;
      const next = idx + dir;
      if (next < 0 || next >= q.length) return q;
      const copy = [...q];
      const tmp = copy[idx];
      copy[idx] = copy[next];
      copy[next] = tmp;
      return copy;
    });
  }

  function removeQueue(id: string) {
    setQueue((q) => q.filter((x) => x.id !== id));
  }

  return (
    <>
      {/* Bubble */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[60] sb-ring flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-lg transition hover:opacity-90 dark:bg-white dark:text-black"
        title="Open SAI"
        aria-label="Open SAI"
      >
        SAI
      </button>

      {/* Drawer / modal */}
      {open && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute bottom-0 right-0 top-0 w-full max-w-[520px] bg-[var(--sb-bg)] sm:bottom-4 sm:right-4 sm:top-4 sm:rounded-2xl sb-ring flex flex-col">
            <div className="sb-glass rounded-none sm:rounded-2xl px-3 py-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-display text-sm font-semibold tracking-tight">SAI</div>
                <div className="text-[11px] opacity-60">Truth-first assistant</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void newChat()}
                  className="sb-ring rounded-full bg-white/70 px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-80 dark:bg-white/10"
                  title="New chat (purge)"
                >
                  New chat
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="sb-ring rounded-full bg-white/70 px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-80 dark:bg-white/10"
                  title="Close"
                >
                  Close
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.length === 0 ? (
                <div className="text-sm opacity-60">
                  Ask about how SpotiBase works, or ask for a data-backed answer.
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={[
                      "rounded-xl border p-2 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-white/70 dark:bg-white/10 ml-8"
                        : "bg-black/[0.03] dark:bg-white/[0.04] mr-8",
                    ].join(" ")}
                    style={{ borderColor: "var(--sb-border)" }}
                  >
                    <div className="text-[11px] font-medium opacity-60 mb-1">{m.role === "user" ? "You" : "SAI"}</div>
                    <div className="text-black/80 dark:text-white/75">{m.content}</div>

                    {m.role === "assistant" && m.meta?.citations?.length ? (
                      <div className="mt-2 text-[11px] opacity-70">
                        <div className="font-medium opacity-80">Sources</div>
                        <div className="mt-1 space-y-1">
                          {m.meta.citations.slice(0, 5).map((c: any) => (
                            <a
                              key={c.chunkId}
                              href={`/docs#${c.chunkId}`}
                              className="block font-mono underline underline-offset-2 transition-opacity hover:opacity-80"
                              style={{ color: "var(--sb-accent)", textDecorationColor: "var(--sb-accent)" }}
                            >
                              /docs#{c.chunkId} — {c.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {m.role === "assistant" && m.meta?.toolCalls?.length ? (
                      <div className="mt-2 text-[11px] opacity-70">
                        <div className="font-medium opacity-80">Calculated from</div>
                        <div className="mt-1 space-y-1">
                          {m.meta.toolCalls.map((t: any, idx: number) => (
                            <div key={idx} className="font-mono">
                              template={t.templateId}
                              {t.params && Object.keys(t.params).length ? ` params=${JSON.stringify(t.params)}` : ""}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              {queue.length > 0 && (
                <div className="rounded-xl border p-2 text-xs" style={{ borderColor: "var(--sb-border)" }}>
                  <div className="font-medium opacity-70 mb-2">Queued messages</div>
                  <div className="space-y-1">
                    {queue.map((q) => (
                      <div key={q.id} className="flex items-center justify-between gap-2">
                        <div className="truncate opacity-80">{q.content}</div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => moveQueue(q.id, -1)} className="underline opacity-60 hover:opacity-100">up</button>
                          <button type="button" onClick={() => moveQueue(q.id, 1)} className="underline opacity-60 hover:opacity-100">down</button>
                          <button type="button" onClick={() => removeQueue(q.id)} className="underline opacity-60 hover:opacity-100">remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sb-glass rounded-none sm:rounded-2xl px-3 py-2">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit();
                    }
                  }}
                  placeholder={isStreaming ? "SAI is responding… (send to queue)" : "Message SAI…"}
                  className="min-h-[44px] w-full resize-none rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none dark:bg-white/5 dark:text-white"
                  style={{ borderColor: "var(--sb-border)" }}
                />
                <button
                  type="button"
                  onClick={onSubmit}
                  className="sb-ring rounded-xl bg-black px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-black"
                  disabled={!input.trim()}
                >
                  {isStreaming ? "Queue" : "Send"}
                </button>
              </div>
              <div className="mt-1 text-[11px] opacity-60">
                Enter to send • Shift+Enter for newline • Accuracy-first: will cite sources or say unsure.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

