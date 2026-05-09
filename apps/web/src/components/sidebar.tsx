"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { Btn, Badge, Kbd, Logo, Mono } from "./ui";
import { fmtNum } from "@/lib/data";
import { useAuth } from "./auth-provider";
import { getSessions, getUsage, getTenantConfig } from "@/lib/api";

const TENANT_PLANS: Record<string, string> = {
  posthog: "Scale · production",
  acme: "Starter · staging",
};

const navItems = [
  { id: "/dashboard", label: "Overview", icon: "home" },
  { id: "/dashboard/prompt", label: "Prompt", icon: "sparkle" },
  { id: "/dashboard/knowledge", label: "Knowledge", icon: "book" },
  { id: "/dashboard/conversations", label: "Conversations", icon: "chat" },
  { id: "/dashboard/settings", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { auth, logout } = useAuth();
  const [liveCount, setLiveCount] = React.useState<number | null>(null);

  const [refreshTick, setRefreshTick] = React.useState(0);

  // Listen for session-refresh events from other components (e.g. conversations page Refresh button)
  React.useEffect(() => {
    const handler = () => setRefreshTick((t) => t + 1);
    window.addEventListener("sessions-updated", handler);
    return () => window.removeEventListener("sessions-updated", handler);
  }, []);

  React.useEffect(() => {
    const tid = auth?.tenantId;
    if (!tid) return;
    let cancelled = false;
    const fetchCount = () => {
      getSessions(tid).then((res) => {
        if (cancelled) return;
        const active = res?.sessions?.filter((s: { source?: string }) => s.source === "redis").length ?? 0;
        setLiveCount(active);
      }).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [auth?.tenantId, pathname, refreshTick]);

  // Fetch real token usage
  const [todayTokens, setTodayTokens] = React.useState(0);
  const [todayLimit, setTodayLimit] = React.useState(80000);

  React.useEffect(() => {
    const tid = auth?.tenantId;
    if (!tid) return;
    let cancelled = false;
    const fetchUsage = () => {
      getUsage(tid).then((res) => {
        if (cancelled) return;
        if (typeof res?.todayTotal === "number") setTodayTokens(res.todayTotal);
      }).catch(() => {});
      getTenantConfig(tid).then((cfg) => {
        if (cancelled) return;
        if (cfg?.maxTokensPerDay > 0) setTodayLimit(cfg.maxTokensPerDay);
      }).catch(() => {});
    };
    fetchUsage();
    const interval = setInterval(fetchUsage, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [auth?.tenantId, pathname]);

  const tenantName = auth?.tenantName || "PostHog";
  const tenantInitial = tenantName[0];
  const plan = TENANT_PLANS[auth?.tenantId || "posthog"] || "Free";
  const displayName = auth?.displayName || "User";
  const initials = displayName.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="tenant-switcher">
          <span className="tenant-avatar">{tenantInitial}</span>
          <div className="tenant-meta">
            <div className="tenant-name">{tenantName}</div>
            <div className="tenant-plan mono">{plan}</div>
          </div>
          <Icon name="chevD" size={12} />
        </button>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section mono">WORKSPACE</div>
        {navItems.map((it) => {
          const active = pathname === it.id;
          return (
            <Link
              key={it.id}
              href={it.id}
              className={`sidebar-item ${active ? "sidebar-item-active" : ""}`}
            >
              <Icon name={it.icon} size={14} />
              <span>{it.label}</span>
              {it.id === "/dashboard/conversations" && liveCount !== null && liveCount > 0 && (
                <Badge kind="success" mono dot style={{ marginLeft: "auto" }}>{liveCount} live</Badge>
              )}
            </Link>
          );
        })}
        <div className="sidebar-section mono">DEMO</div>
        <Link href="/chat" className={`sidebar-item ${pathname === "/chat" ? "sidebar-item-active" : ""}`}>
          <Icon name="play" size={14} />
          <span>Full-page chat</span>
        </Link>
        {/* <Link href="/" className={`sidebar-item ${pathname === "/" ? "sidebar-item-active" : ""}`}>
          <Icon name="ext" size={14} />
          <span>Landing page</span>
        </Link> */}
      </nav>
      <div className="sidebar-bot">
        <div className="sidebar-usage">
          <div className="sidebar-usage-row">
            <span className="mono dim">Tokens today</span>
            <span className="mono">{fmtNum(todayTokens)} / {fmtNum(todayLimit)}</span>
          </div>
          <div className="usage-bar usage-bar-thin">
            <div className="usage-bar-fill" style={{ width: (todayTokens / todayLimit) * 100 + "%" }} />
          </div>
        </div>
        <button className="user-row" onClick={logout} title="Sign out">
          <span className="user-avatar">{initials}</span>
          <div className="user-meta">
            <div className="user-name">{displayName}</div>
            <div className="user-role mono dim">Sign out</div>
          </div>
          <Icon name="arrowL" size={12} />
        </button>
      </div>
    </aside>
  );
}

export function DashboardTopstrip() {
  const { auth } = useAuth();
  const [status, setStatus] = React.useState<{ ok: boolean; provider: string; sessions: number } | null>(null);

  React.useEffect(() => {
    import("@/lib/api").then(({ getHealth }) => {
      getHealth().then((data) => {
        setStatus({ ok: data.status === "ok", provider: data.provider, sessions: data.activeSessions });
      }).catch(() => setStatus(null));
    });
  }, []);

  return (
    <div className="topstrip">
      <div className="topstrip-l mono">
        {status?.ok ? (
          <>
            <span className="success-dot" />
            <span>Backend connected</span>
            <span className="topstrip-sep">·</span>
            <span className="dim">{status.provider}</span>
            <span className="topstrip-sep">·</span>
            <span className="dim">{status.sessions} active session{status.sessions !== 1 ? "s" : ""}</span>
          </>
        ) : (
          <>
            <span className="warning-dot" />
            <span>Backend unavailable</span>
          </>
        )}
      </div>
      <div className="topstrip-r">
        <span className="mono dim" style={{ fontSize: 11 }}>{auth?.tenantId}</span>
        <a href="/chat" target="_blank" rel="noopener noreferrer">
          <Btn kind="ghost" size="sm" icon="ext">Open chat</Btn>
        </a>
      </div>
    </div>
  );
}
