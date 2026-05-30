"use client";

// Team chat — fully fixed page (only the message list scrolls).
// Features:
//   - Plain text messages
//   - Image attachments (gallery picker)
//   - Shared tranche cards (posted from Pocket → click to save to own Pocket)
//   - "X is typing..." floating indicator via Realtime broadcast
//   - Clear-all-chat admin button
// Voice messages removed by user request.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle, Send, AlertTriangle, Pencil, Image as ImageIcon,
  Trash2, Briefcase, BookmarkPlus, Check,
} from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabaseClient";
import { upsertTranche } from "@/lib/storage";
import { decodeTranche } from "@/lib/trancheShare";
import { PixelTim } from "@/components/PixelTim";
import type { Tranche } from "@/lib/types";

const NAME_KEY = "snd.chat.senderName.v1";
const MAX_LOAD = 200;
const TYPING_TTL_MS = 3500;
const TYPING_BROADCAST_MS = 1500;

interface ChatMessage {
  id: string;
  sender_name: string;
  body: string;
  attachment_url: string | null;
  attachment_type: "image" | "audio" | "tranche" | null;
  created_at: string;
}

function colourFor(name: string): string {
  const palette = ["#7BA7E0","#7CC09E","#C7A0E0","#E8B86C","#E0857D","#D4B85E","#88C2BC","#B49DD6"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function relativeTime(iso: string): string {
  // Show the actual clock time on every message — "10:30", "Yesterday 14:22",
  // "Mon 09:15", "12 May 16:48". Far more informative than "1h ago" / "5m ago"
  // when scrolling through a long thread.
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) {
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${day} ${time}`;
  }
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${date} ${time}`;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable string hash for deriving each Tim's tint and phase from a username.
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

// Different brown shades for multiple Tims. All warm — never green/blue.
const TIM_TINTS = [
  "",  // default brown
  "brightness(1.15) saturate(0.9)",        // lighter, slightly desaturated
  "brightness(0.82)",                      // darker chocolate
  "hue-rotate(15deg) saturate(1.1)",       // warmer reddish-brown
  "hue-rotate(-8deg) brightness(0.95)",    // cooler taupe
  "brightness(1.1) sepia(0.25)",           // honey
  "brightness(0.9) saturate(1.15)",        // dark cocoa
];

export default function ChatPage() {
  const supa = useMemo(() => getSupabaseBrowser(), []);
  const [name, setName] = useState<string>("");
  const [editingName, setEditingName] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [flyingBubbles, setFlyingBubbles] = useState<Array<{
    id: string; text: string; startX: number; startY: number; startW: number; endX: number; endY: number;
  }>>([]);
  const listEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingBroadcast = useRef<number>(0);
  const typingChannelRef = useRef<any>(null);

  // ─── Lock document scroll while on /chat ───
  // Prevents the whole page bouncing when the user keyboard-types, taps
  // the composer, or pulls down to refresh. Restored on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ─── Hydrate name ───
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setName(saved); else setEditingName(true);
    } catch {}
  }, []);

  // ─── Initial message load ───
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
      setMessages(((data || []) as ChatMessage[]).slice().reverse());
      setLoading(false);
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    })();
    return () => { cancelled = true; };
  }, [supa]);

  // ─── Realtime: new messages + delete sync + typing broadcasts ───
  useEffect(() => {
    if (!supa) return;
    const msgCh = supa.channel("chat_messages_inserts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        setMessages((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
        setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, () => {
        setMessages([]);
      })
      .subscribe();

    const typeCh = supa.channel("chat_typing", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload: any) => {
        const who: string = payload?.payload?.name;
        if (!who) return;
        setTypingUsers((prev) => ({ ...prev, [who]: Date.now() + TYPING_TTL_MS }));
      })
      .subscribe();
    typingChannelRef.current = typeCh;

    return () => { supa.removeChannel(msgCh); supa.removeChannel(typeCh); };
  }, [supa]);

  // Expire stale typing indicators
  useEffect(() => {
    const id = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const out: Record<string, number> = {};
        let changed = false;
        for (const k of Object.keys(prev)) {
          if (prev[k] > now) out[k] = prev[k]; else changed = true;
        }
        return changed ? out : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Presence: who's currently on this page right now ───
  useEffect(() => {
    if (!supa || !name.trim()) return;
    const ch = supa.channel("chat_presence", { config: { presence: { key: name.trim() } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, unknown>;
      setOnlineUsers(Object.keys(state));
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ at: Date.now() });
      }
    });
    return () => { supa.removeChannel(ch); };
  }, [supa, name]);

  const broadcastTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    if (!ch || !name) return;
    const now = Date.now();
    if (now - lastTypingBroadcast.current < TYPING_BROADCAST_MS) return;
    lastTypingBroadcast.current = now;
    ch.send({ type: "broadcast", event: "typing", payload: { name } });
  }, [name]);

  function saveName() {
    const v = name.trim();
    if (!v) return;
    try { localStorage.setItem(NAME_KEY, v); } catch {}
    setEditingName(false);
  }

  async function uploadImage(file: Blob): Promise<string | null> {
    if (!supa) return null;
    const ext = (file.type.split("/")[1] || "jpg").split(";")[0];
    const path = `chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supa.storage.from("chat-attachments").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) { setError(error.message); return null; }
    const { data } = supa.storage.from("chat-attachments").getPublicUrl(path);
    return data.publicUrl;
  }

  // Wraps send() with an iMessage-style "bubble flies from textarea to chat
  // list" animation. The real send still happens via send() — this is purely
  // visual: a ghost bubble is positioned at the textarea, then animated up
  // to where the new message will land.
  function sendWithFly() {
    const text = input.trim();
    if (!text || !name.trim()) return;
    const ta = textareaRef.current;
    const end = listEndRef.current;
    if (ta && end) {
      const ar = ta.getBoundingClientRect();
      const er = end.getBoundingClientRect();
      // Land near the right edge (sender's own bubbles align right)
      const fly = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        text,
        startX: ar.left + 12,
        startY: ar.top + 4,
        startW: Math.min(ar.width - 24, 240),
        endX: er.right - 180,
        endY: er.top - 36,
      };
      setFlyingBubbles((prev) => [...prev, fly]);
      window.setTimeout(() => {
        setFlyingBubbles((prev) => prev.filter((b) => b.id !== fly.id));
      }, 520);
    }
    void send();
  }

  async function send(opts?: { attachmentUrl?: string; attachmentType?: "image" | "tranche"; bodyOverride?: string }) {
    if (!supa) return;
    const text = (opts?.bodyOverride ?? input).trim();
    const hasAttachment = !!opts?.attachmentUrl || opts?.attachmentType === "tranche";
    if ((!text && !hasAttachment) || !name.trim()) return;
    setSending(true);
    if (!opts?.bodyOverride) setInput("");
    const { error } = await supa.from("chat_messages").insert({
      sender_name: name.trim().slice(0, 32),
      body: text.slice(0, 2000) || "",
      attachment_url: opts?.attachmentUrl ?? null,
      attachment_type: opts?.attachmentType ?? null,
    });
    if (error) { setError(error.message); if (!opts?.bodyOverride) setInput(text); }
    setSending(false);
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("Image too large (max 10 MB)."); return; }
    setSending(true);
    const url = await uploadImage(file);
    if (url) await send({ attachmentUrl: url, attachmentType: "image", bodyOverride: "" });
    setSending(false);
  }

  async function clearAllChat() {
    if (!confirm("Clear ALL chat history for everyone? This cannot be undone.")) return;
    setError(null);
    const res = await fetch("/api/chat/clear", { method: "POST" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j?.error || "Clear failed."); return; }
    setMessages([]);
  }

  const typingOthers = Object.keys(typingUsers).filter((n) => n !== name);

  // ─── Render: unconfigured state ───
  if (!supa) {
    return (
      <>
        <ChatHeader onlineUsers={onlineUsers} ownName={name} />
        <div className="card mb-3 border-l-4 border-l-warning p-4 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle size={14} /> Chat not yet configured
          </div>
          <p className="text-[var(--text-muted)]">
            Set <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel + run the SQL in <code>db/chat-messages.sql</code>.
          </p>
        </div>
      </>
    );
  }

  return (
    // Fixed positioning — sits between the sticky header (top) and bottom-nav
    // (bottom). Body scroll is locked in the useEffect above, so nothing
    // moves on the page except the message list.
    <div
      className="fixed inset-x-0 flex flex-col"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 170px)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)",
        paddingLeft: "max(env(safe-area-inset-left, 0px), 12px)",
        paddingRight: "max(env(safe-area-inset-right, 0px), 12px)",
      }}
    >
      <ChatHeader onlineUsers={onlineUsers} ownName={name} />

      {/* Name bar + clear-chat */}
      <section className="card mb-2 flex flex-shrink-0 items-center justify-between gap-2 p-3">
        {editingName ? (
          <div className="flex flex-1 items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Your name</span>
            <input
              autoFocus value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
              placeholder="e.g. Aiden" maxLength={32}
              className="input h-8 flex-1 text-[13px]"
            />
            <button onClick={saveName} className="btn btn-primary h-8 px-3 text-[11px]">Save</button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: colourFor(name) }}
              >{initials(name)}</div>
              <div className="text-[12.5px]">
                Posting as <strong className="text-[var(--text)]">{name}</strong>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setEditingName(true)} className="btn h-7 px-2 text-[11px]" title="Change name">
                <Pencil size={11} /> Edit
              </button>
              <button onClick={clearAllChat} className="btn h-7 px-2 text-[11px] text-danger" title="Wipe all chat history for everyone">
                <Trash2 size={11} /> Clear
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Message list — the only scrollable area */}
      <section className="card mb-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {loading && <p className="text-center text-[12px] text-[var(--text-muted)]">Loading messages...</p>}
          {!loading && messages.length === 0 && (
            <div className="py-8 text-center">
              <MessageCircle size={28} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
              <p className="text-[12.5px] text-[var(--text-muted)]">No messages yet.</p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showAvatar = !prev || prev.sender_name !== m.sender_name;
            const isMe = m.sender_name === name;
            const trancheData = m.attachment_type === "tranche" ? decodeTranche(m.body) : null;
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {showAvatar ? (
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: colourFor(m.sender_name) }}
                  >{initials(m.sender_name)}</div>
                ) : (<div className="w-7 flex-shrink-0" />)}

                <div className={`max-w-[85%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                  {showAvatar && (
                    <div className={`mb-0.5 flex items-baseline gap-1.5 text-[10.5px] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <strong className="text-[var(--text)]">{m.sender_name}</strong>
                      <span className="text-[var(--text-muted)]">{relativeTime(m.created_at)}</span>
                    </div>
                  )}
                  {trancheData ? (
                    <div className="msg-bubble"><TrancheCard tranche={trancheData} /></div>
                  ) : (
                    <div
                      className={`msg-bubble rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${isMe ? "rounded-br-md" : "bg-[var(--surface-2)] rounded-bl-md"}`}
                      style={isMe ? { background: "rgba(124, 167, 224, 0.18)" } : undefined}
                    >
                      {m.attachment_type === "image" && m.attachment_url && (
                        <a href={m.attachment_url} target="_blank" rel="noreferrer">
                          <img src={m.attachment_url} alt="" className="mb-1 max-h-[260px] rounded-lg" />
                        </a>
                      )}
                      {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>

        {typingOthers.length > 0 && (
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[11px] italic text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex gap-0.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--text-muted)]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--text-muted)]" style={{ animationDelay: "0.15s" }} />
                <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--text-muted)]" style={{ animationDelay: "0.3s" }} />
              </span>
              {typingOthers.length === 1
                ? `${typingOthers[0]} is typing...`
                : typingOthers.length === 2
                  ? `${typingOthers[0]} and ${typingOthers[1]} are typing...`
                  : `${typingOthers.length} people are typing...`}
            </span>
          </div>
        )}
      </section>

      {/* Composer */}
      <section className="card flex-shrink-0 p-2.5">
        <div className="flex items-end gap-1.5">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!name.trim() || sending}
            className="btn h-10 px-2.5"
            title="Attach image"
          >
            <ImageIcon size={16} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); broadcastTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendWithFly(); } }}
            placeholder={name ? `Message as ${name}...` : "Set your name above first"}
            maxLength={2000} rows={1}
            disabled={!name.trim()}
            className="input min-h-[40px] flex-1 resize-none py-2 text-[13px]"
            style={{ maxHeight: 140 }}
          />

          <button
            onClick={() => sendWithFly()}
            disabled={!input.trim() || !name.trim() || sending}
            className="btn btn-primary h-10 px-3 text-[12px] active:scale-90 transition-transform"
            title="Send (Enter)"
          >
            <Send size={14} />
          </button>
        </div>
      </section>

      {error && <p className="mt-1 flex-shrink-0 text-center text-[11px] text-danger">{error}</p>}

      {/* Flying ghost bubbles — iMessage-style "bubble takes off from the
          textarea and lands in the chat list". Lives in a fixed layer so
          coordinates are screen-relative. */}
      {flyingBubbles.map((b) => (
        <div
          key={b.id}
          className="fly-bubble pointer-events-none fixed z-50 rounded-2xl rounded-br-md px-3 py-2 text-[13px] leading-relaxed shadow-md"
          style={{
            left: `${b.startX}px`,
            top: `${b.startY}px`,
            width: `${b.startW}px`,
            background: "rgba(124, 167, 224, 0.55)",
            color: "var(--text)",
            ["--fly-dx" as any]: `${b.endX - b.startX}px`,
            ["--fly-dy" as any]: `${b.endY - b.startY}px`,
          }}
        >
          <span className="whitespace-pre-wrap break-words">{b.text}</span>
        </div>
      ))}
    </div>
  );
}

function ChatHeader({ onlineUsers = [], ownName = "" }: { onlineUsers?: string[]; ownName?: string } = {}) {
  // Build the unique list of people sharing this chat right now — self + others.
  // Multiple Tims render on top of each other in the same track, each a
  // slightly different brown shade and walking at a different phase, so it
  // looks like a little group of teddies sharing the room.
  const allUsers = (() => {
    const set = new Set<string>();
    if (ownName.trim()) set.add(ownName.trim());
    for (const u of onlineUsers) if (u && u.trim()) set.add(u.trim());
    return Array.from(set);
  })();

  return (
    <header className="mb-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        <MessageCircle size={16} />
        <h1 className="text-base font-semibold">Team chat</h1>
        {allUsers.length > 1 && (
          <span className="ml-auto text-[10.5px] text-[var(--text-muted)]">
            {allUsers.length} Tims online 🧸
          </span>
        )}
      </div>
      {/* Tim row — one Tim per person on the page. They share the track
          (overlap visually when they bump into each other = cute). */}
      <div className="mt-5 flex justify-center">
        <div className="relative" style={{ width: 320, height: 46 }}>
          {(allUsers.length === 0 ? [""] : allUsers).map((user) => {
            const hash = hashName(user || "default");
            const tint = TIM_TINTS[hash % TIM_TINTS.length];
            // Negative animation-delay shifts each Tim's phase so they're at
            // different points in the walk cycle.
            const delay = `-${(hash % 11000) / 1000}s`;
            return (
              <div key={user || "default"} className="absolute inset-0 flex justify-center">
                <PixelTim
                  trackWidth={320}
                  size={40}
                  tintFilter={tint || undefined}
                  animationDelay={delay}
                />
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}

/* ───────────────── Tranche-share card ─────────────────
   Rendered inside a chat bubble when attachment_type === "tranche".
   Compact, banking-style mini-table with a Save-to-Pocket button. */
function TrancheCard({ tranche }: { tranche: Tranche }) {
  const [saved, setSaved] = useState(false);
  function handleSave() {
    upsertTranche(tranche);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[11.5px] w-[260px] max-w-full">
      <header className="mb-1.5 flex items-center justify-between gap-2 border-b border-[var(--line)] pb-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Briefcase size={12} className="flex-shrink-0 text-accent" />
          <span className="truncate font-mono text-[12.5px] font-semibold">{tranche.trancheCode}</span>
        </div>
        <span className="rounded bg-[var(--surface)] border border-[var(--line)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {tranche.currency}
        </span>
      </header>
      <div className="grid grid-cols-3 gap-1 text-center">
        <Cell label="Coupon" value={`${(tranche.couponPa * 100).toFixed(1)}%`} />
        <Cell label="Tenor"  value={`${tranche.tenorMonths}M`} />
        <Cell label="Strike" value={`${(tranche.strikePct * 100).toFixed(0)}%`} />
        <Cell label="KO"     value={`${(tranche.koStartPct * 100).toFixed(0)}%`} />
        <Cell label="Step"   value={`-${(tranche.koStepdownPct * 100).toFixed(0)}%`} />
        <Cell label="EKI"    value={`${(tranche.ekiPct * 100).toFixed(0)}%`} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {tranche.underlyings.slice(0, 4).map((u) => (
          <span key={u.symbol} className="rounded-full bg-[var(--surface)] border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-mono">
            {u.symbol}<span className="ml-1 text-[var(--text-muted)]">{u.market}</span>
          </span>
        ))}
      </div>
      <button
        onClick={handleSave}
        disabled={saved}
        className="mt-2 w-full btn btn-primary h-7 text-[11px]"
      >
        {saved ? (<><Check size={11} /> Saved to Pocket</>) : (<><BookmarkPlus size={11} /> Save to my Pocket</>)}
      </button>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[var(--surface)] py-1 px-0.5">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="tabular text-[11px] font-semibold">{value}</div>
    </div>
  );
}
