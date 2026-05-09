"use client";

import React, { useState, useEffect } from "react";
import { Icon } from "@/components/icons";
import { Btn, Badge, PageHeader, Empty, Mono } from "@/components/ui";
import { ChatTurn } from "@/components/chat-widget";
import { useAuth } from "@/components/auth-provider";
import { getSessions, getConversation } from "@/lib/api";
import { type Turn } from "@/lib/data";

type SessionSummary = {
  id: string;
  tenantId: string;
  turns: number;
  tokens: number;
  messageCount: number;
  source?: string; // "redis" = active, "postgres" = historical
};

// Convert raw OpenAI-format messages from the agent-core into Turn[] for the ChatTurn component.
// Agent-core stores: system, user (content string), assistant (content string + optional tool_calls[]),
// and tool (content = result, tool_call_id).
function messagesToTurns(messages: Array<Record<string, unknown>>): Turn[] {
  const turns: Turn[] = [];

  for (const m of messages) {
    const role = m.role as string;

    // Skip system messages
    if (role === "system") continue;

    if (role === "user") {
      turns.push({ role: "user", text: String(m.content || "") });
    } else if (role === "assistant") {
      // Check for tool_calls first
      const toolCalls = m.tool_calls as Array<{ function?: { name?: string; arguments?: string } }> | undefined;
      if (toolCalls && toolCalls.length > 0) {
        // Show each tool call
        for (const tc of toolCalls) {
          const fnName = tc.function?.name || "tool";
          let query = "";
          try {
            const args = JSON.parse(tc.function?.arguments || "{}");
            query = args.query || args.input || args.q || JSON.stringify(args).slice(0, 80);
          } catch {
            query = tc.function?.arguments?.slice(0, 80) || "";
          }
          turns.push({
            role: "tool",
            name: fnName,
            query,
            result: "completed",
          });
        }
      }
      // Always show the text content if present
      const content = String(m.content || "");
      if (content) {
        turns.push({ role: "assistant", text: content });
      }
    } else if (role === "tool") {
      // Tool result message — we already showed the tool call above from the assistant message,
      // so skip the raw tool result to avoid duplication
      continue;
    }
  }

  return turns;
}

export default function ConversationsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "posthog";

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMessages, setDetailMessages] = useState<Array<Record<string, unknown>>>([]);
  const [detailMeta, setDetailMeta] = useState<{ sessionId: string; tokenUsage: unknown } | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [q, setQ] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshSessions = () => {
    setRefreshKey((k) => k + 1);
    // Notify sidebar to update its count too
    window.dispatchEvent(new Event("sessions-updated"));
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSessions(true);
      try {
        const res = await getSessions(tenantId);
        if (cancelled) return;
        if (res?.sessions) {
          setSessions(res.sessions);
          if (res.sessions.length > 0 && !selectedId) setSelectedId(res.sessions[0].id);
        }
      } catch {}
      finally { if (!cancelled) setLoadingSessions(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId, refreshKey]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(refreshSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  const [detailRefresh, setDetailRefresh] = useState(0);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    async function load() {
      setLoadingDetail(true);
      try {
        const res = await getConversation(selectedId!);
        if (cancelled) return;
        if (res) {
          setDetailMessages(res.messages || []);
          setDetailMeta({ sessionId: res.sessionId, tokenUsage: res.tokenUsage });
        }
      } catch {
        setDetailMessages([]);
        setDetailMeta(null);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedId, detailRefresh]);

  const filteredSessions = sessions.filter((s) =>
    !q || s.id.toLowerCase().includes(q.toLowerCase())
  );

  const detailTurns = messagesToTurns(detailMessages);

  return (
    <div className="page page-no-scroll">
      <PageHeader
        eyebrow="Conversations"
        title="Transcripts"
        sub={`Every conversation for ${tenantId}. ${sessions.filter(s => s.source === "redis").length} active, ${sessions.filter(s => s.source === "postgres").length} ended.`}
        actions={
          <>
            <Btn kind="ghost" size="sm" icon="filter" disabled title="Coming soon">Export CSV</Btn>
            <Btn kind="secondary" size="sm" icon="ext" disabled title="Coming soon">Open in Slack</Btn>
          </>
        }
      />
      <div className="convo-split">
        <div className="convo-list">
          <div className="convo-list-toolbar">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="search-input" style={{ flex: 1 }}>
                <Icon name="search" size={14} />
                <input placeholder="Search by session ID..." value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Btn kind="ghost" size="sm" icon="filter" onClick={refreshSessions} title="Refresh sessions">
                Refresh
              </Btn>
            </div>
          </div>
          <div className="convo-list-body">
            {loadingSessions ? (
              <div style={{ padding: 20, textAlign: "center", opacity: 0.5 }}>Loading sessions...</div>
            ) : filteredSessions.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", opacity: 0.5 }}>No active sessions.</div>
            ) : (
              filteredSessions.map((s) => (
                <button
                  key={s.id}
                  className={`convo-item ${selectedId === s.id ? "convo-item-active" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className="convo-item-top">
                    <span className="convo-id mono">{s.id.slice(0, 12)}...</span>
                    <span className={`convo-status ${s.source === "redis" ? "o" : "r"}`}>
                      {s.source === "redis" ? "● active" : "● ended"}
                    </span>
                  </div>
                  <div className="convo-preview">{s.turns} user message(s)</div>
                  <div className="convo-item-meta mono">
                    <span>{s.messageCount} total msgs</span>
                    <span>·</span>
                    <span>{(s.tokens || 0).toLocaleString()} tok</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="convo-detail">
          <div className="convo-detail-hd">
            <div>
              <div className="convo-detail-title">
                {selectedId ? `Session` : "Conversation"}
              </div>
              <div className="convo-detail-sub mono">
                {detailMeta ? (
                  <>
                    <span>{detailMeta.sessionId.slice(0, 16)}...</span>
                    <span>·</span>
                    <span>{detailTurns.filter(t => t.role !== "tool").length} turns</span>
                  </>
                ) : (
                  <span>Select a session</span>
                )}
              </div>
            </div>
            <div className="convo-detail-actions">
              <Btn kind="ghost" size="sm" icon="filter" onClick={() => setDetailRefresh(k => k + 1)}>Refresh</Btn>
              <Btn kind="ghost" size="sm" icon="copy" disabled title="Coming soon">Copy as JSON</Btn>
            </div>
          </div>
          <div className="convo-detail-body">
            {loadingDetail ? (
              <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>Loading conversation...</div>
            ) : detailTurns.length === 0 ? (
              <Empty title="Pick a conversation" sub="Select a transcript on the left to view it here." />
            ) : (
              detailTurns.map((t, i) => <ChatTurn key={i} turn={t} showTokens />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
