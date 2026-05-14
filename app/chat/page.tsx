"use client";

// Team chat — 5th bottom-nav tab. Real-time via Supabase Realtime.
//
// Each device reads + posts via the anon Supabase key. Sender name is
// chosen once + stored in localStorage. New messages arrive over a
// WebSocket subscription so no polling.

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, AlertTriangle, Pencil } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabaseClient";

const NAME_KEY = "snd.chat.senderName.v1";
const MAX_LOAD = 200;

interface ChatMessage {
  id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

/** Stable per-name colour so each sender has a consistent avatar tint. */
function colourFor(name: string): string {
  const palette = [
    "#7BA7E0", // soft sky blue
    "#7CC09E", // sage green
    "#C7A0E0", // soft lavender
    "#E8B86C", // warm amber
    "#E0857D", // dusty coral
    "#D4B85E", // gentle gold
    "#88C2BC", // teal
    "#B49DD6", // muted purple
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** "5m", "2h", "yesterday", or "8 May" depending on how old the message is. */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const secs = (Date.now() - t) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 172800) return "yesterday";
  const d = new Date(t);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChatPage() {
  const supa = useMemo(() => getSupabaseBrowser(), []);
  const [name, setName] = useState<string>("");
  const [editingName, setEditingName] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);

  // Hydrate sender name from localStorage. If first visit, prompt.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
      else setEditingName(true);
    } catch {}
  }, []);

  // Initial load — last MAX_LOAD messages, newest at the bottom.
  useEffect(() => {
    if (!supa) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const { data, error } = await supa
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_LOAD);
      if (cancelled) return;
      if (error) { setError(error.message); setLoading(false); return; }
      // Returned newest-first — reverse to chronological for the UI.
      setMessages(((data || []) as ChatMessage[]).slice().reverse());
      setLoading(false);
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    })();
    return () => { cancelled = true; };
  }, [supa]);

  // Realtime subscription — append new INSERTs to the list as they arrive.
  useEffect(() => {
    if (!supa) return;
    const channel = supa
      .channel("chat_messages_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((prev) => {
            // De-dupe by id (our own optimistic insert + the realtime echo).
            if (prev.some((p) => p.id === m.id)) return prev;
            return [...prev, m];
          });
          setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
        }
      )
      .subscribe();
    return () => { supa.removeChannel(channel); };
  }, [supa]);

  function saveName() {
    const v = name.trim();
    if (!v) return;
    try { localStorage.setItem(NAME_KEY, v); } catch {}
    setEditingName(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || !name.trim() || !supa) return;
    setSending(true);
    setInput("");
    const { error } = await supa.from("chat_messages").insert({
      sender_name: name.trim().slice(0, 32),
      body: text.slice(0, 2000),
    });
    if (error) { setError(error.message); setInput(text); /* restore */ }
    setSending(false);
  }

  // ─── render: not-configured state ───
  if (!supa) {
    return (
      <>
        <ChatHeader />
        <div className="card mb-3 border-l-4 border-l-warning p-4 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle size={14} /> Chat not yet configured
          </div>
          <p className="text-[var(--text-muted)]">
            The team chat needs <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> set
            in Vercel env vars. Get it from Supabase Settings → API → Project
            API keys → <strong>anon public</strong>. Add it to Vercel + redeploy +
            run the SQL in <code>db/chat-messages.sql</code>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <ChatHeader />

      {/* Sender-name row — editable inline */}
      <section className="card mb-3 flex items-center justify-between gap-2 p-3">
        {editingName ? (
          <div className="flex flex-1 items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Your name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
              placeholder="e.g. Aiden"
              maxLength={32}
              className="input h-8 flex-1 text-[13px]"
            />
            <button onClick={saveName} className="btn btn-primary h-8 px-3 text-[11px]">Save</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: colourFor(name) }}
            >
              {initials(name)}
            </div>
            <div className="text-[12.5px]">
              Posting as <strong className="text-[var(--text)]">{name}</strong>
            </div>
            <button onClick={() => setEditingName(true)} className="btn h-7 px-2 text-[11px]" title="Change name">
              <Pencil size={11} /> Edit
            </button>
          </div>
        )}
      </section>

      {/* Message list */}
      <section className="card mb-3 flex flex-col" style={{ minHeight: "55vh" }}>
        <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "60vh" }}>
          {loading && (
            <p className="text-center text-[12px] text-[var(--text-muted)]">Loading messages...</p>
          )}
          {!loading && messages.length === 0 && (
            <div className="py-8 text-center">
              <MessageCircle size={28} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
              <p className="text-[12.5px] text-[var(--text-muted)]">No messages yet. Be the first to say hello.</p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showAvatar = !prev || prev.sender_name !== m.sender_name;
            const isMe = m.sender_name === name;
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {showAvatar ? (
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: colourFor(m.sender_name) }}
                  >
                    {initials(m.sender_name)}
                  </div>
                ) : (
                  <div className="w-7 flex-shrink-0" />
                )}
                <div className={`max-w-[78%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                  {showAvatar && (
                    <div className={`mb-0.5 flex items-baseline gap-1.5 text-[10.5px] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <strong className="text-[var(--text)]">{m.sender_name}</strong>
                      <span className="text-[var(--text-muted)]">{relativeTime(m.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                      isMe
                        ? "bg-accent-500/15 text-[var(--text)] rounded-br-md"
                        : "bg-[var(--surface-2)] text-[var(--text)] rounded-bl-md"
                    }`}
                    style={isMe ? { background: "rgba(124, 167, 224, 0.18)" } : undefined}
                  >
                    <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>
      </section>

      {/* Composer — sticky-ish at bottom of the card stack */}
      <section className="card sticky bottom-[88px] z-30 p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={name ? `Message the team as ${name}...` : "Set your name above first"}
            maxLength={2000}
            rows={1}
            disabled={!name.trim()}
            className="input min-h-[40px] flex-1 resize-none py-2 text-[13px]"
            style={{ maxHeight: 140 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || !name.trim() || sending}
            className="btn btn-primary h-10 px-3 text-[12px]"
            title="Send (Enter)"
          >
            <Send size={14} /> {sending ? "..." : "Send"}
          </button>
        </div>
      </section>

      {error && (
        <p className="mt-2 text-center text-[11px] text-danger">{error}</p>
      )}
      <p className="mt-3 text-center text-[10.5px] text-[var(--text-muted)]">
        Messages stored in Supabase. Anyone with the app URL can read &amp; post — keep this PWA install private.
      </p>
    </>
  );
}

function ChatHeader() {
  return (
    <header className="mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Team chat
      </div>
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <MessageCircle size={18} /> Chat
      </h1>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Quick chat for colleagues using this app. Real-time — your messages appear instantly on every device.
      </p>
    </header>
  );
}
