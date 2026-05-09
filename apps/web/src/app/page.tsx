"use client";

import React from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Btn, Badge, Logo } from "@/components/ui";
import { ChatSurface, useChat } from "@/components/chat-widget";
import { featuredConvo } from "@/lib/data";

function LandingDemoFrame() {
  const seed = React.useMemo(() => featuredConvo.turns.slice(0, 3), []);
  const chat = useChat({ initial: seed });
  return (
    <div className="lp-demo-frame">
      <div className="lp-demo-tabs mono">
        <span className="lp-demo-tab active">posthog.com / docs / agent</span>
        <span style={{ flex: 1 }} />
        <span className="lp-demo-meta">live preview</span>
      </div>
      <div className="lp-demo-body">
        <div className="lp-demo-chat">
          <ChatSurface
            state={chat}
            density="cozy"
            showTokens={false}
            placeholder="Try: 'How do I mask credit-card inputs in session replay?'"
            suggestions={[]}
          />
        </div>
        <div className="lp-demo-side">
          <div className="lp-demo-side-hd mono">REQUEST INSPECTOR</div>
          <div className="lp-demo-side-body">
            <div className="lp-side-row"><span>tenant</span><span className="mono">tn_posthog</span></div>
            <div className="lp-side-row"><span>session</span><span className="mono">sess_8f3a91b2</span></div>
            <div className="lp-side-row"><span>model</span><span className="mono">gemini-2.0-flash</span></div>
            <div className="lp-side-row"><span>tools</span><span className="mono">search_kb · web_fetch</span></div>
            <div className="lp-side-row"><span>turns</span><span className="mono">{chat.turns.filter(t => t.role !== "tool").length}</span></div>
            <div className="lp-side-row"><span>tokens</span><span className="mono">{chat.turns.reduce((a, t) => a + (t.tokens || 0), 0).toLocaleString()}</span></div>
            <div className="lp-side-row"><span>p95 latency</span><span className="mono">412ms</span></div>
            <div className="lp-side-divider" />
            <div className="lp-side-h mono">RECENT TOOL CALLS</div>
            <div className="lp-side-tool"><span className="success-dot" /> search_kb · 4 docs · 0.31s</div>
            <div className="lp-side-tool"><span className="success-dot" /> search_kb · 2 docs · 0.28s</div>
            <div className="lp-side-tool"><span className="success-dot" /> web_fetch · 1 url · 0.92s</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// TODO: Replace this URL with your actual demo video (Loom/YouTube)
const DEMO_VIDEO_URL = "";

function LandingDemoTabs() {
  const [tab, setTab] = React.useState<"live" | "video">("live");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20, gap: 4 }}>
        <div className="seg-tabs">
          <button className={`seg-tab ${tab === "live" ? "seg-active" : ""}`} onClick={() => setTab("live")}>
            <Icon name="play" size={12} /> Live demo
          </button>
          <button className={`seg-tab ${tab === "video" ? "seg-active" : ""}`} onClick={() => setTab("video")}>
            <Icon name="chart" size={12} /> Watch video
          </button>
        </div>
      </div>
      {tab === "live" ? (
        <LandingDemoFrame />
      ) : (
        <div className="lp-demo-frame" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 540 }}>
          {DEMO_VIDEO_URL ? (
            <iframe
              src={DEMO_VIDEO_URL}
              style={{ width: "100%", height: 540, border: 0, borderRadius: 14 }}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div style={{ textAlign: "center", padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>
                <Icon name="play" size={48} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--fg-2)" }}>Demo video coming soon</div>
              <div style={{ fontSize: 13, color: "var(--fg-4)", marginTop: 6 }}>
                Try the live demo in the meantime — it connects to a real agent.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="lp-nav">
        <div className="lp-nav-left">
          <Logo />
          <nav className="lp-nav-links">
            <a>Product</a><a>Docs</a><a>Pricing</a><a>Changelog</a>
          </nav>
        </div>
        <div className="lp-nav-right">
          <a className="lp-link mono">v0.4.2 →</a>
          <Link href="/chat"><Btn kind="ghost" size="sm">Try the demo</Btn></Link>
          <Link href="/dashboard"><Btn kind="primary" size="sm" iconRight="arrow">Dashboard</Btn></Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-inner">
          <Badge kind="neutral" mono dot style={{ marginBottom: 24 }}>
            <span style={{ color: "var(--success)" }}>●</span>&nbsp; SOC 2 Type II · multi-tenant · self-hostable
          </Badge>
          <h1 className="lp-h1">
            AI support that<br />
            <span className="lp-h1-em">actually reads your docs.</span>
          </h1>
          <p className="lp-sub">
            Not a chatbot. An agent that searches, reasons, and cites&nbsp;sources.<br />
            Multi-tenant, cost-tracked, production-ready.
          </p>
          <div className="lp-cta">
            <Link href="/dashboard">
              <Btn kind="primary" size="lg" iconRight="arrow">Open dashboard</Btn>
            </Link>
            <Link href="/chat">
              <Btn kind="secondary" size="lg" icon="play">Try the agent</Btn>
            </Link>
          </div>
          <div className="lp-trust mono">
            <span>Trusted by infrastructure teams at</span>
            <span className="lp-trust-logos">
              <span>POSTHOG</span><span>·</span><span>ACME</span><span>·</span><span>NEONDB</span><span>·</span><span>RESEND</span><span>·</span><span>FLY.IO</span>
            </span>
          </div>
        </div>
        <div className="lp-hero-glow" aria-hidden="true" />
      </section>

      <section className="lp-demo">
        <LandingDemoTabs />
      </section>

      <section className="lp-features">
        <div className="lp-features-grid">
          {[
            { icon: "book", title: "Grounded in your docs", body: "Indexes Markdown, MDX, OpenAPI, and Notion. Re-embeds on every commit. The agent only answers from sources it can cite." },
            { icon: "cmd", title: "Tool-using by default", body: "Searches the knowledge base, looks up status pages, and reads release notes. You see every tool call in the transcript." },
            { icon: "chart", title: "Per-tenant cost tracking", body: "Token usage, model breakdown, and daily limits scoped to each tenant. Hard caps prevent runaway spend." },
            { icon: "server", title: "Self-host or hosted", body: "Single-tenant Docker or our managed cloud. Bring your own model — Claude, GPT, or open-source via vLLM." },
            { icon: "key", title: "Embed in 30 seconds", body: "One <script> tag. Custom theming, custom prompt per project, session-scoped memory in Redis." },
            { icon: "flask", title: "A/B test your prompt", body: "Ship a new system prompt to 10% of conversations. Compare deflection rate and CSAT before rolling out." },
          ].map((f, i) => (
            <div className="feat" key={i}>
              <div className="feat-icon"><Icon name={f.icon} size={16} /></div>
              <div className="feat-title">{f.title}</div>
              <div className="feat-body">{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-strip">
        <div className="lp-strip-inner">
          <div>
            <div className="eyebrow">Production stats</div>
            <div className="lp-strip-h">Running on the same stack we ship to customers.</div>
          </div>
          <div className="lp-strip-stats">
            <div><div className="lp-stat-v mono">1.2M</div><div className="lp-stat-l">conversations / month</div></div>
            <div><div className="lp-stat-v mono">340ms</div><div className="lp-stat-l">median first token</div></div>
            <div><div className="lp-stat-v mono">87%</div><div className="lp-stat-l">deflection rate</div></div>
            <div><div className="lp-stat-v mono">$0.0021</div><div className="lp-stat-l">avg cost per turn</div></div>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-inner">
          <Logo />
          <div className="lp-foot-cols mono">
            <span>helpdesk.ai · 2026</span>
            <span>·</span>
            <a>status</a>
            <a>changelog</a>
            <a>privacy</a>
            <a>terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
