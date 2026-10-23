"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Check, X, AlertTriangle, Info } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  exiting: boolean;
}

interface ToastContextValue {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastCtx = createContext<ToastContextValue>({
  success: () => {},
  error: () => {},
  info: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const push = useCallback((message: string, kind: ToastKind) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev.slice(-3), { id, message, kind, exiting: false }]);
    setTimeout(() => dismiss(id), 2500);
  }, [dismiss]);

  const ctx: ToastContextValue = {
    success: (msg) => push(msg, "success"),
    error:   (msg) => push(msg, "error"),
    info:    (msg) => push(msg, "info"),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {/* Toast stack — sits above the bottom nav */}
      <div className="no-print fixed bottom-[72px] inset-x-0 z-[200] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-2.5 shadow-xl",
              "text-[13px] font-medium max-w-sm w-full",
              "border backdrop-blur-md transition-all duration-300",
              t.exiting ? "opacity-0 translate-y-2 scale-95" : "opacity-100 translate-y-0 scale-100",
              t.kind === "success" && "bg-[#0f2a1a]/90 border-[#137a4a]/40 text-[#6dd49a]",
              t.kind === "error"   && "bg-[#2a0f0f]/90 border-[#b3261e]/40 text-[#ff8b85]",
              t.kind === "info"    && "bg-[var(--surface)]/90 border-[var(--line)] text-[var(--text)]",
            )}
            style={{ transition: "opacity .3s, transform .3s cubic-bezier(.34,1.56,.64,1)" }}
          >
            {t.kind === "success" && <Check size={14} className="shrink-0" />}
            {t.kind === "error"   && <AlertTriangle size={14} className="shrink-0" />}
            {t.kind === "info"    && <Info size={14} className="shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
