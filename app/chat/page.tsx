"use client";

// Team chat — 5th bottom-nav tab. Real-time via Supabase Realtime.
// Features:
//   - Plain text messages with sender name + avatar initials
//   - Image attachments (gallery picker)
//   - Voice messages (hold to record, release to send)
//   - "X is typing..." floating indicator via Realtime broadcast
//   - Clear-all-chat admin button (calls /api/chat/clear, service_role)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle, Send, AlertTriangle, Pencil, Mic, Image as ImageIcon,
  Trash2, Square,
} from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabaseClient";

const NAME_KEY = "snd.chat.senderName.v1";
const MAX_LOAD = 200;
const TYPING_TTL_MS = 3500;        // hide indicator if no event in this window
const TYPING_BROADCAST_MS = 1500;  // rate-limit our own typing broadcasts

interface ChatMessage {
  id: string;
  sender_name: string;
  body: string;
  attachment_url: string | null;
  attachment_type: "image" | "audio" | null;
  created_at: string;
}

function colourFor(name: string): string {
  const palette = ["#7BA7E0","#7CC09E","#C7A0E0","#E8B86C","#E0857D","#D4B85E","#88C2BC","#B49DD6"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 172800) return "yesterday";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});  // name → expiresAt
  const [recording, setRecording] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lastTypingBroadcast = useRef<number>(0);
  const typingChannelRef = useRef<any>(null);

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

  // ─── Realtime: new messages + typing broadcasts on a separate channel ───
  useEffect(() => {
    if (!supa) return;
    const msgCh = supa.channel("chat_messages_inserts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        setMessages((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
        setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, () => {
        // When admin clears, every device should also empty its list.
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

  // ─── Expire stale typing indicators ───
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

  // ─── Broadcast our own typing event (rate-limited) ───
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

  async function uploadAttachment(file: Blob, kind: "image" | "audio"): Promise<string | null> {
    if (!supa) return null;
    const ext = kind === "image" ? (file.type.split("/")[1] || "jpg") : (file.type.split("/")[1] || "webm");
    const path = `chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supa.storage.from("chat-attachments").upload(path, file, {
      contentType: file.type || (kind === "image" ? "image/jpeg" : "audio/webm"),
      upsert: false,
    });
    if (error) { setError(error.message); return null; }
    const { data } = supa.storage.from("chat-attachments").getPublicUrl(path);
    return data.publicUrl;
  }

  async function send(opts?: { attachmentUrl?: string; attachmentType?: "image" | "audio"; bodyOverride?: string }) {
    if (!supa) return;
    const text = (opts?.bodyOverride ?? input).trim();
    const hasAttachment = !!opts?.attachmentUrl;
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
    e.target.value = "";  // reset so picking same file again still fires onChange
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("Image too large (max 10 MB)."); return; }
    setSending(true);
    const url = await uploadAttachment(file, "image");
    if (url) await send({ attachmentUrl: url, attachmentType: "image", bodyOverride: "" });
    setSending(false);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) { setError("Microphone not supported on this device."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) recordedChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return;  // ignore micro-taps
        setSending(true);
        const url = await uploadAttachment(blob, "audio");
        if (url) await send({ attachmentUrl: url, attachmentType: "audio", bodyOverride: "" });
        setSending(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e: any) {
      setError("Mic permission denied — enable in iOS Settings → " + (window.location.host));
    }
  }
  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  async function clearAllChat() {
    if (!confirm("Clear ALL chat history for everyone? This cannot be undone.")) return;
    setError(null);
    const res = await fetch("/api/chat/clear", { method: "POST" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j?.error || "Clear failed."); return; }
    setMessages([]);
  }

  // Filter out our own name from the typing list — we don't need to see ourselves.
  const typingOthers = Object.keys(typingUsers).filter((n) => n !== name);

  // ─── render: unconfigured state ───
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

      {/* Sender-name row — editable inline, plus Clear-chat */}
      <section className="card mb-3 flex items-center justify-between gap-2 p-3">
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
                <Trash2 size={11} /> Clear chat
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Message list */}
      <section className="card mb-3 flex flex-col" style={{ minHeight: "55vh" }}>
        <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "60vh" }}>
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
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {showAvatar ? (
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: colourFor(m.sender_name) }}
                  >{initials(m.sender_name)}</div>
                ) : (<div className="w-7 flex-shrink-0" />)}

                <div className={`max-w-[78%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                  {showAvatar && (
                    <div className={`mb-0.5 flex items-baseline gap-1.5 text-[10.5px] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <strong className="text-[var(--text)]">{m.sender_name}</strong>
                      <span className="text-[var(--text-muted)]">{relativeTime(m.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${isMe ? "rounded-br-md" : "bg-[var(--surface-2)] rounded-bl-md"}`}
                    style={isMe ? { background: "rgba(124, 167, 224, 0.18)" } : undefined}
                  >
                    {m.attachment_type === "image" && m.attachment_url && (
                      <a href={m.attachment_url} target="_blank" rel="noreferrer">
                        <img src={m.attachment_url} alt="" className="mb-1 max-h-[260px] rounded-lg" />
                      </a>
                    )}
                    {m.attachment_type === "audio" && m.attachment_url && (
                      <audio controls src={m.attachment_url} className="mb-1 w-[220px] max-w-full" />
                    )}
                    {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>

        {/* Floating typing indicator */}
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
      <section className="card sticky bottom-[88px] z-30 p-2.5">
        <div className="flex items-end gap-1.5">
          {/* Image attach */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!name.trim() || sending || recording}
            className="btn h-10 px-2.5"
            title="Attach image"
          >
            <ImageIcon size={16} />
          </button>

          {/* Voice — press & hold to record.
              The inline CSS suppresses iOS Safari's default behaviours that
              kick in when you hold a button: blue tap-highlight flash,
              text-selection highlight, magnifying-glass context menu, and
              the "Copy/Share/Look Up" callout that pops up on long-press. */}
          <button
            onPointerDown={(e) => { e.preventDefault(); if (name.trim() && !sending) startRecording(); }}
            onPointerUp={(e) => { e.preventDefault(); if (recording) stopRecording(); }}
            onPointerCancel={() => { if (recording) stopRecording(); }}
            onPointerLeave={() => { if (recording) stopRecording(); }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={!name.trim() || sending}
            className={`btn h-10 px-2.5 select-none ${recording ? "bg-danger/20 text-danger" : ""}`}
            style={{
              WebkitTapHighlightColor: "transparent",
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
              touchAction: "none",
            }}
            title="Hold to record a voice message"
          >
            {recording ? <Square size={14} /> : <Mic size={16} />}
          </button>

          {/* Text input */}
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); broadcastTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={name ? (recording ? "Recording... release to send" : `Message as ${name}...`) : "Set your name above first"}
            maxLength={2000} rows={1}
            disabled={!name.trim() || recording}
            className="input min-h-[40px] flex-1 resize-none py-2 text-[13px]"
            style={{ maxHeight: 140 }}
          />

          <button
            onClick={() => send()}
            disabled={!input.trim() || !name.trim() || sending || recording}
            className="btn btn-primary h-10 px-3 text-[12px]"
            title="Send (Enter)"
          >
            <Send size={14} />
          </button>
        </div>
        {recording && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-danger">
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
            Recording — release the mic to send
          </div>
        )}
      </section>

      {error && <p className="mt-2 text-center text-[11px] text-danger">{error}</p>}
      <p className="mt-3 text-center text-[10.5px] text-[var(--text-muted)]">
        Messages stored in Supabase. Images + voice notes uploaded to chat-attachments bucket.
      </p>
    </>
  );
}

function ChatHeader() {
  return (
    <header className="mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Team chat</div>
      <h1 className="text-xl font-semibold flex items-center gap-2"><MessageCircle size={18} /> Chat</h1>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Secure internal team channel. Messages deliver in real time.
      </p>
    </header>
  );
}
