"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Btn, Badge, Logo, Mono } from "@/components/ui";
import { ChatSurface, useChat } from "@/components/chat-widget";
import { useAuth } from "@/components/auth-provider";
import { getHealth } from "@/lib/api";

const DEMO_TENANTS = [
  { id: "posthog", name: "PostHog" },
  { id: "acme", name: "Acme Corp" },
];

function ChatDebugRail({ chat, demoTenant, model }: { chat: ReturnType<typeof useChat>; demoTenant: string; model: string }) {
  const totalTokens = chat.turns.reduce((a, t) => a + (t.tokens || 0), 0);
  // Rough cost estimate — varies by provider. Free for Groq, ~$0.075/1M for Gemini Flash
  const cost = totalTokens * 0.000000075;
  return (
    <aside className="chat-debug">
      <div className="chat-debug-h mono">DEBUG</div>
      <div className="chat-debug-section">
        <div className="chat-debug-row"><span>session</span><Mono>{chat.sessionId?.slice(0, 12) || "..."}</Mono></div>
        <div className="chat-debug-row"><span>tenant</span><Mono>{demoTenant}</Mono></div>
        <div className="chat-debug-row"><span>model</span><Mono>{model}</Mono></div>
        <div className="chat-debug-row"><span>temp</span><Mono>0.2</Mono></div>
      </div>
      <div className="chat-debug-h mono">USAGE</div>
      <div className="chat-debug-section">
        <div className="chat-debug-row"><span>turns</span><Mono>{chat.turns.filter(t => t.role !== "tool").length}</Mono></div>
        <div className="chat-debug-row"><span>tool calls</span><Mono>{chat.turns.filter(t => t.role === "tool").length}</Mono></div>
        <div className="chat-debug-row"><span>tokens</span><Mono>{totalTokens.toLocaleString()}</Mono></div>
        <div className="chat-debug-row"><span>cost</span><Mono>${cost.toFixed(6)}</Mono></div>
      </div>
      <div className="chat-debug-h mono">TOOL CALLS</div>
      <div className="chat-debug-section">
        {chat.turns.filter(t => t.role === "tool").length === 0 && <div className="dim mono" style={{ fontSize: 11 }}>none yet</div>}
        {chat.turns.filter(t => t.role === "tool").map((t, i) => (
          <div className="chat-debug-tool" key={i}>
            <span className="success-dot" />
            <Mono>{t.name}</Mono>
            <span className="dim mono">· {t.result}</span>
          </div>
        ))}
      </div>
      <div className="chat-debug-h mono">CITATIONS</div>
      <div className="chat-debug-section">
        {chat.turns.flatMap(t => t.citations || []).length === 0 && <div className="dim mono" style={{ fontSize: 11 }}>none yet</div>}
        {chat.turns.flatMap(t => t.citations || []).map((c, i) => (
          <div className="chat-debug-cite" key={i}>
            <Mono dim>[{c.n}]</Mono>
            <span>{c.title}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function ChatFullPage() {
  const { auth, isLoggedIn } = useAuth();
  const [demoTenant, setDemoTenant] = useState(DEMO_TENANTS[0]);
  const [showDebug, setShowDebug] = useState(true);
  const [model, setModel] = useState("loading...");

  // Fetch actual model from backend health endpoint
  useEffect(() => {
    getHealth()
      .then((data) => setModel(data.provider || "unknown"))
      .catch(() => setModel("unavailable"));
  }, []);

  const activeTenantId = isLoggedIn ? auth!.tenantId : demoTenant.id;
  const activeTenantName = isLoggedIn ? auth!.tenantName : demoTenant.name;

  const chat = useChat({ tenantOverride: activeTenantId });

  const switchDemoTenant = (t: typeof DEMO_TENANTS[0]) => {
    setDemoTenant(t);
    chat.reset();
  };

  return (
    <div className="chat-fp">
      <header className="chat-fp-hd">
        <div className="chat-fp-hd-l">
          <div className="chat-fp-brand">
            <Logo />
            <span className="chat-fp-divider">/</span>
            <span className="chat-fp-tenant">{activeTenantName} support</span>
          </div>
          {!isLoggedIn && (
            <div style={{ display: "flex", gap: 2, marginLeft: 12 }}>
              {DEMO_TENANTS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => switchDemoTenant(t)}
                  className={`seg-tab ${demoTenant.id === t.id ? "seg-active" : ""}`}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chat-fp-hd-r">
          <Badge kind="neutral" mono dot>● {chat.turns.length === 0 ? "ready" : `${chat.turns.filter(t => t.role !== "tool").length} turns`}</Badge>
          <Btn kind="ghost" size="sm" onClick={() => setShowDebug(!showDebug)}>
            {showDebug ? "Hide" : "Show"} debug
          </Btn>
          <Btn kind="ghost" size="sm" icon="x" onClick={() => chat.reset()}>New conversation</Btn>
          {!isLoggedIn && <Link href="/login"><Btn kind="secondary" size="sm" icon="user">Sign in</Btn></Link>}
          {isLoggedIn && <Link href="/dashboard"><Btn kind="ghost" size="sm" icon="home">Dashboard</Btn></Link>}
        </div>
      </header>
      <div className="chat-fp-body" style={!showDebug ? { gridTemplateColumns: "1fr" } : undefined}>
        <div className="chat-fp-main">
          <div className="chat-fp-stage">
            <ChatSurface
              state={chat}
              density="cozy"
              showTokens={showDebug}
              emptyTitle={`Ask anything about ${activeTenantName}`}
              emptySubtitle="I'll search your indexed docs and cite sources."
              suggestions={[
                "How do I create a feature flag?",
                "Mask credit cards in session replay",
                "Weekly retention HogQL query",
                "identify() vs alias()",
              ]}
            />
          </div>
        </div>
        {showDebug && <ChatDebugRail chat={chat} demoTenant={activeTenantId} model={model} />}
      </div>
    </div>
  );
}
