"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Btn, Card, Stat, Badge, PageHeader, BarChart, Mono } from "@/components/ui";
import { ChatSurface, useChat } from "@/components/chat-widget";
import { useAuth } from "@/components/auth-provider";
import { getUsage, getSessions, getHealth, getTenantConfig } from "@/lib/api";
import { fmtNum } from "@/lib/data";

// Fallback mock data used when API calls fail
const fallbackTokensByHour = [
  412, 280, 196, 168, 122, 154, 320, 1240, 2980, 4310, 5120, 4870,
  3920, 4560, 5240, 5810, 5390, 4720, 3210, 2140, 1480, 980, 720, 540,
];
const fallbackTodayTokens = fallbackTokensByHour.reduce((a, b) => a + b, 0);
const fallbackLimit = 80000;

export default function OverviewPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "tn_demo";
  const chat = useChat({});

  const [loading, setLoading] = useState(true);
  const [todayTokens, setTodayTokens] = useState(fallbackTodayTokens);
  const [todayLimit, setTodayLimit] = useState(fallbackLimit);
  const [tokensByHour, setTokensByHour] = useState(fallbackTokensByHour);
  const [dailyData, setDailyData] = useState<{ date: string; total_tokens: string }[]>([]);
  const [sessions, setSessions] = useState<{ id: string; tenantId: string; turns: number; tokens: number; messageCount: number; source?: string }[]>([]);
  const [activeSessions, setActiveSessions] = useState(0);
  const [chartPeriod, setChartPeriod] = useState<"1h" | "24h" | "7d" | "30d">("24h");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [usageRes, sessionsRes, configRes] = await Promise.allSettled([
          getUsage(tenantId),
          getSessions(tenantId),
          getTenantConfig(tenantId),
        ]);

        if (cancelled) return;

        if (usageRes.status === "fulfilled" && usageRes.value) {
          const u = usageRes.value;
          if (u.hourly) setTokensByHour(u.hourly);
          if (typeof u.todayTotal === "number") setTodayTokens(u.todayTotal);
          if (u.daily) setDailyData(u.daily);
        }

        if (sessionsRes.status === "fulfilled" && sessionsRes.value?.sessions) {
          const allSessions = sessionsRes.value.sessions;
          setSessions(allSessions);
          const redisSessions = allSessions.filter((s: { source?: string }) => s.source === "redis").length;
          setActiveSessions(redisSessions);
        }

        if (configRes.status === "fulfilled" && configRes.value) {
          if (configRes.value.maxTokensPerDay > 0) {
            setTodayLimit(configRes.value.maxTokensPerDay);
          }
        }
      } catch {
        // Keep fallback data on failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const usagePct = todayLimit > 0 ? (todayTokens / todayLimit) * 100 : 0;
  const hourLabels = ["12a","","","3","","","6","","","9","","","12p","","","3","","","6","","","9","",""];
  const nowHour = new Date().getHours();
  const costToday = `$${(todayTokens * 0.000000075).toFixed(4)}`;

  // Build chart data based on selected period
  const getChartData = () => {
    if (chartPeriod === "24h" || chartPeriod === "1h") {
      // 1h just shows last few hours of the same hourly data
      const data = chartPeriod === "1h" ? tokensByHour.slice(Math.max(0, nowHour - 6), nowHour + 1) : tokensByHour;
      const labels = chartPeriod === "1h"
        ? data.map((_, i) => `${Math.max(0, nowHour - 6) + i}:00`)
        : hourLabels;
      return { data, labels, sub: `last ${chartPeriod} · per hour · ${todayTokens.toLocaleString()} / ${todayLimit.toLocaleString()}` };
    }
    // 7d or 30d — use dailyData
    const days = chartPeriod === "7d" ? 7 : 30;
    const sliced = dailyData.slice(0, days).reverse();
    const data = sliced.map((d) => parseInt(d.total_tokens, 10) || 0);
    const labels = sliced.map((d) => {
      const dt = new Date(d.date);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    });
    const total = data.reduce((a, b) => a + b, 0);
    return { data, labels, sub: `last ${days} days · per day · ${total.toLocaleString()} total tokens` };
  };
  const chart = getChartData();

  if (loading) {
    return (
      <div className="page">
        <PageHeader eyebrow="Overview" title="Today" sub="Loading dashboard data..." />
        <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Overview"
        title="Today"
        sub={`Token usage for tenant ${tenantId}. ${sessions.length} session(s) found.`}
        actions={
          <>
            <Link href="/dashboard/settings"><Btn kind="ghost" size="sm" icon="settings">Settings</Btn></Link>
            <Link href="/dashboard/conversations"><Btn kind="secondary" size="sm" icon="chat">Conversations</Btn></Link>
            <a href="/chat" target="_blank" rel="noopener noreferrer">
              <Btn kind="primary" size="sm" icon="play">Open chat</Btn>
            </a>
          </>
        }
      />

      <div className="overview-grid">
        <div className="overview-left">
          <div className="stat-row">
            <Stat label="Tokens today" value={todayTokens.toLocaleString()} sub={
              <span>{usagePct > 80 ? <span style={{ color: "var(--warning)" }}>approaching limit</span> : `${Math.round(usagePct)}% of daily cap`}</span>
            } />
            <Stat label="Active sessions" value={String(activeSessions)} sub={`${sessions.length} total (incl. ended)`} accent />
            <Stat label="Avg latency" value="412ms" sub="p95 · last 1h" />
            <Stat label="Cost today" value={costToday} sub={`${todayTokens.toLocaleString()} tokens`} />
          </div>

          <Card>
            <div className="card-hd">
              <div>
                <div className="card-title">Token usage</div>
                <div className="card-sub mono">{chart.sub}</div>
              </div>
              <div className="seg-tabs">
                {(["1h", "24h", "7d", "30d"] as const).map((p) => (
                  <button
                    key={p}
                    className={`seg-tab ${chartPeriod === p ? "seg-active" : ""}`}
                    onClick={() => setChartPeriod(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="usage-bar">
              <div className="usage-bar-fill" style={{ width: Math.min(100, usagePct) + "%" }} />
              <div className="usage-bar-marker" style={{ left: "80%" }} title="Soft warning at 80%" />
            </div>
            <div className="usage-bar-lbl mono">
              <span>{Math.round(usagePct)}% of daily limit · {Math.max(0, todayLimit - todayTokens).toLocaleString()} remaining</span>
              <span style={{ color: "var(--warning)" }}>● limit at 80%</span>
            </div>
            {chart.data.length > 0 ? (
              <BarChart
                data={chart.data}
                labels={chart.labels}
                accentIdx={chartPeriod === "24h" ? nowHour : chartPeriod === "1h" ? chart.data.length - 1 : undefined}
                max={Math.max(...chart.data) * 1.1 || 1}
              />
            ) : (
              <div style={{ padding: "20px 16px", textAlign: "center", opacity: 0.5 }} className="mono">No data for this period</div>
            )}
          </Card>

          <div className="row-2">
            <Card>
              <div className="card-hd">
                <div className="card-title">Active sessions</div>
                <Badge kind="success" mono dot>{activeSessions} live</Badge>
              </div>
              <div className="sess-list">
                {sessions.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", opacity: 0.5 }}>No active sessions</div>
                ) : (
                  sessions.map((s) => (
                    <div className="sess-item" key={s.id}>
                      <div className="sess-status"><span className="success-dot" /></div>
                      <div className="sess-main">
                        <div className="sess-id mono">{s.id}</div>
                        <div className="sess-user">{s.tenantId}</div>
                      </div>
                      <div className="sess-meta mono">
                        <span>{s.turns} turns</span>
                        <span>·</span>
                        <span>{(s.tokens || 0).toLocaleString()} tok</span>
                        <span>·</span>
                        <span>{s.messageCount} msgs</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="card-hd">
                <div className="card-title">Top searched topics</div>
                <span className="card-sub mono">last 7d · mock data</span>
              </div>
              <div className="topics-list">
                {[
                  { name: "feature-flags", count: 412, trend: "up" as const },
                  { name: "session-replay", count: 287, trend: "up" as const },
                  { name: "hogql", count: 194, trend: "flat" as const },
                  { name: "sdk-js", count: 168, trend: "down" as const },
                  { name: "experiments", count: 142, trend: "up" as const },
                  { name: "self-host", count: 98, trend: "flat" as const },
                  { name: "pricing", count: 71, trend: "up" as const },
                ].map((t, i) => (
                  <div className="topic-row" key={i}>
                    <div className="topic-name mono">{t.name}</div>
                    <div className="topic-bar">
                      <div className="topic-bar-fill" style={{ width: (t.count / 412) * 100 + "%" }} />
                    </div>
                    <div className="topic-count mono">{t.count}</div>
                    <span className={`trend trend-${t.trend}`}>{t.trend === "up" ? "↑" : t.trend === "down" ? "↓" : "→"}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <div className="overview-right">
          <div className="preview-frame">
            <div className="preview-frame-hd">
              <div>
                <div className="preview-frame-title">Test your agent</div>
                <div className="preview-frame-sub mono">{tenantId} · staging · streaming off</div>
              </div>
              <div className="preview-frame-actions">
                <Link href="/dashboard/prompt">
                  <Btn kind="ghost" size="sm" icon="edit">Edit prompt</Btn>
                </Link>
                <Btn kind="ghost" size="sm" icon="x" onClick={() => chat.reset()} title="New session">New</Btn>
              </div>
            </div>
            <ChatSurface
              state={chat}
              density="compact"
              showTokens
              emptyTitle="Test your agent live"
              emptySubtitle="Edit the prompt and watch behavior change in real time."
              suggestions={[
                "How do I roll out a feature flag to 25% in EU?",
                "Mask credit-card inputs in session replay",
                "HogQL: weekly retention query",
                "Difference between identify() and alias()?",
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
