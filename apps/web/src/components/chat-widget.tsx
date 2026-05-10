"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Icon } from "./icons";
import { Btn, Kbd, ToolCall, CitationChip } from "./ui";
import { renderRich } from "./rich-text";
import { sendMessageStream, clearSession } from "@/lib/api";
import { createSessionId, getTenantId } from "@/lib/session";
import type { Turn } from "@/lib/data";

export function useChat({ initial = [], mock = false, tenantOverride }: { initial?: Turn[]; mock?: boolean; tenantOverride?: string } = {}) {
  // Generate a unique session ID per chat instance — not shared across tabs
  const [turns, setTurns] = useState<Turn[]>(initial);
  const [pending, setPending] = useState<{ phase: "tool" | "thinking" } | null>(null);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => createSessionId());
  const [tenantId, setTenantId] = useState<string>(tenantOverride || "posthog");

  // Refs to avoid stale closures in send/reset callbacks
  const sessionIdRef = useRef(sessionId);
  const tenantIdRef = useRef(tenantId);
  const pendingRef = useRef(pending);
  sessionIdRef.current = sessionId;
  tenantIdRef.current = tenantId;
  pendingRef.current = pending;

  useEffect(() => {
    if (!tenantOverride) {
      const tid = getTenantId();
      setTenantId(tid);
      tenantIdRef.current = tid;
    }
  }, [tenantOverride]);

  useEffect(() => {
    if (tenantOverride) {
      setTenantId(tenantOverride);
      tenantIdRef.current = tenantOverride;
    }
  }, [tenantOverride]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || pendingRef.current) return;
    const currentSessionId = sessionIdRef.current;
    const currentTenantId = tenantIdRef.current;
    if (!currentSessionId) return;

    const userTurn: Turn = { role: "user", text, ts: new Date() };
    setTurns((t) => [...t, userTurn]);
    setInput("");
    setPending({ phase: "tool" });

    // Track streaming state via refs so the SSE callback always sees latest
    let assistantText = "";
    let assistantAdded = false;
    let totalTokens = 0;

    try {
      await sendMessageStream(text, currentTenantId, currentSessionId, (event) => {
        const d = event.data;

        switch (event.type) {
          case "tool_start":
            setTurns((t) => [
              ...t,
              {
                role: "tool",
                name: String(d.name || "tool"),
                query: JSON.stringify(d.args || {}).slice(0, 80),
                ts: new Date(),
              },
            ]);
            break;

          case "tool_end":
            // Update the last tool turn with the result
            setTurns((t) => {
              const updated = [...t];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === "tool" && !updated[i].result) {
                  updated[i] = { ...updated[i], result: `${d.ok ? "done" : "error"} · ${String(d.result || "").slice(0, 60)}` };
                  break;
                }
              }
              return updated;
            });
            setPending({ phase: "thinking" });
            break;

          case "text":
            if (!assistantAdded) {
              // Add the assistant turn placeholder
              assistantAdded = true;
              setPending(null);
              setTurns((t) => [...t, { role: "assistant", text: String(d.token || ""), ts: new Date() }]);
            } else {
              // Append token to the last assistant turn
              setTurns((t) => {
                const updated = [...t];
                const last = updated[updated.length - 1];
                if (last.role === "assistant") {
                  updated[updated.length - 1] = { ...last, text: (last.text || "") + String(d.token || "") };
                }
                return updated;
              });
            }
            assistantText += String(d.token || "");
            break;

          case "done":
            totalTokens = (d.turnTokens as { totalTokens?: number })?.totalTokens || 0;
            // Update the assistant turn with final token count
            setTurns((t) => {
              const updated = [...t];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                updated[updated.length - 1] = { ...last, tokens: totalTokens };
              }
              return updated;
            });
            break;

          case "error":
            setTurns((t) => [
              ...t,
              { role: "assistant", text: `Error: ${d.message || "Unknown error"}`, ts: new Date() },
            ]);
            break;
        }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (!assistantAdded) {
        setTurns((t) => [...t, { role: "assistant", text: `Error: ${message}`, ts: new Date() }]);
      }
    } finally {
      setPending(null);
    }
  }, []); // no deps — uses refs

  const reset = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    const currentTenantId = tenantIdRef.current;
    if (currentSessionId && currentTenantId) {
      try { await clearSession(currentTenantId, currentSessionId); } catch {}
    }
    const newId = createSessionId();
    setSessionId(newId);
    sessionIdRef.current = newId;
    setTurns([]);
    setPending(null);
  }, []); // no deps — uses refs

  return { turns, pending, input, setInput, send, reset, setTurns, sessionId, tenantId };
}

export type ChatState = ReturnType<typeof useChat>;

// Single message bubble
export function ChatTurn({ turn, showTokens, compact = false }: { turn: Turn; showTokens?: boolean; compact?: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-bubble">{turn.text}</div>
      </div>
    );
  }
  if (turn.role === "tool") {
    return <ToolCall name={turn.name || "tool"} query={turn.query} result={turn.result} />;
  }
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L3 5v6l5 3 5-3V5L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 5v6M5 6.5l3 1.5 3-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="msg-body">
        <div className="msg-rich">{turn.text && renderRich(turn.text)}</div>
        {turn.citations && turn.citations.length > 0 && (
          <div className="cite-row">
            {turn.citations.map((c) => (
              <CitationChip key={c.n} n={c.n} title={c.title} />
            ))}
          </div>
        )}
        {showTokens && turn.tokens != null && (
          <div className="msg-meta mono">
            <span>{turn.tokens} tokens</span>
            <span className="dot-sep">·</span>
            <span>${(turn.tokens * 0.000000075).toFixed(6)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Pending indicator
export function ChatPending({ phase }: { phase: string }) {
  if (phase === "tool") {
    return <ToolCall name="search_knowledge_base" query="searching indexed documents..." />;
  }
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar"><span className="msg-pulse" /></div>
      <div className="msg-body">
        <div className="thinking-dots"><i /><i /><i /></div>
      </div>
    </div>
  );
}

// Compose box
export function ChatCompose({ value, onChange, onSend, disabled, placeholder, suggestions }: {
  value: string; onChange: (v: string) => void; onSend: (v: string) => void;
  disabled?: boolean; placeholder?: string; suggestions?: string[];
}) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(value);
    }
  };
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(160, taRef.current.scrollHeight) + "px";
  }, [value]);
  return (
    <div className="compose">
      {suggestions && suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="suggestion" onClick={() => onSend(s)}>{s}</button>
          ))}
        </div>
      )}
      <div className="compose-row">
        <textarea
          ref={taRef}
          className="compose-input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder || "Ask a question..."}
          disabled={disabled}
        />
        <button className="compose-send" disabled={!value.trim() || disabled} onClick={() => onSend(value)} aria-label="Send">
          <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="compose-foot">
        <span className="mono"><Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline</span>
        <span className="mono compose-foot-r">powered by <strong>helpdesk.ai</strong></span>
      </div>
    </div>
  );
}

// Full chat surface
export function ChatSurface({ state, header, footer, showTokens = false, emptyTitle = "Ask anything about PostHog", emptySubtitle = "I'm trained on your published docs and updated nightly.", suggestions, placeholder, density = "cozy" }: {
  state: ChatState; header?: React.ReactNode; footer?: React.ReactNode; showTokens?: boolean;
  emptyTitle?: string; emptySubtitle?: string; suggestions?: string[]; placeholder?: string; density?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [state.turns.length, state.pending]);

  const empty = state.turns.length === 0;

  // Check if an LLM API key is configured
  const [hasKey, setHasKey] = useState(true);
  const [keyDismissed, setKeyDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const gemini = localStorage.getItem("helpdesk-gemini-key");
    const groq = localStorage.getItem("helpdesk-groq-key");
    setHasKey(!!(gemini || groq));
  }, []);

  return (
    <div className={`chat-surface chat-${density}`}>
      {header}
      {/* API key info banner — non-blocking */}
      {!hasKey && !keyDismissed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", margin: "8px 12px 0",
          background: "var(--warning-faint)", borderRadius: "var(--radius-sm)",
          fontSize: 12, color: "var(--warning)",
        }}>
          <Icon name="bolt" size={14} />
          <div style={{ flex: 1 }}>
            <strong>API key needed for chat.</strong>{" "}
            Add your Gemini key in{" "}
            <a href="/dashboard/settings?tab=model" style={{ color: "var(--accent-hi)", textDecoration: "underline" }}>Settings → Model & API keys</a>{" "}
            or get one free at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
               style={{ color: "var(--accent-hi)", textDecoration: "underline" }}>aistudio.google.com</a>.
          </div>
          <button onClick={() => setKeyDismissed(true)} style={{
            background: "none", border: "none", color: "var(--warning)",
            cursor: "pointer", padding: 2, flexShrink: 0,
          }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className="chat-stream" ref={ref}>
        {empty ? (
          <div className="chat-empty">
            <div className="chat-empty-mark">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L3 5v6l5 3 5-3V5L8 2z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 5v6M5 6.5l3 1.5 3-1.5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </div>
            <div className="chat-empty-title">{emptyTitle}</div>
            <div className="chat-empty-sub">{emptySubtitle}</div>
          </div>
        ) : (
          state.turns.map((t, i) => <ChatTurn key={i} turn={t} showTokens={showTokens} />)
        )}
        {state.pending && <ChatPending phase={state.pending.phase} />}
      </div>
      <ChatCompose
        value={state.input}
        onChange={state.setInput}
        onSend={state.send}
        disabled={!!state.pending}
        placeholder={placeholder}
        suggestions={empty ? suggestions : undefined}
      />
      {footer}
    </div>
  );
}
