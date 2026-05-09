"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo, Btn } from "@/components/ui";
import { Icon } from "@/components/icons";

// Hardcoded admin accounts — in production these come from a real auth provider.
// Tenant is tied to the account, not chosen by the user.
const ADMIN_ACCOUNTS = [
  { email: "marius@posthog.com", password: "demo", name: "Marius Andra", tenantId: "posthog", tenantName: "PostHog" },
  { email: "admin@acme.com", password: "demo", name: "Alex Chen", tenantId: "acme", tenantName: "Acme Corp" },
];

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLoggedIn) router.replace("/dashboard");
  }, [isLoggedIn, router]);

  const handleLogin = () => {
    setError("");
    const account = ADMIN_ACCOUNTS.find(
      (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password
    );
    if (!account) {
      setError("Invalid email or password");
      return;
    }
    login(account.tenantId, account.tenantName, account.name);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg)",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex" }}><Logo size={24} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 16, marginBottom: 4 }}>Welcome back</h1>
          <p style={{ color: "var(--fg-3)", fontSize: 13, margin: 0 }}>
            Sign in to your admin dashboard
          </p>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", display: "block", marginBottom: 6 }}>
              Email
            </label>
            <input
              className="text-input"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onKey}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", display: "block", marginBottom: 6 }}>
              Password
            </label>
            <input
              className="text-input"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: "var(--error)",
              background: "var(--error-faint)", borderRadius: "var(--radius-sm)",
              padding: "8px 10px", marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button
            className="btn btn-primary btn-md"
            style={{ width: "100%" }}
            disabled={!email.trim() || !password}
            onClick={handleLogin}
          >
            Sign in
            <Icon name="arrow" size={14} />
          </button>
        </div>

        <div className="card" style={{ padding: 20, marginTop: 12, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-2)", marginBottom: 8 }}>
            Want to try the full dashboard?
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.6 }}>
            This is a live multi-tenant AI agent platform. To get demo access or
            discuss how it works, reach out directly.
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <a href="mailto:ayushnautiyaldevelopr@gmail.com" style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", background: "var(--card-2)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--fg)", textDecoration: "none", fontFamily: "inherit", fontSize: 13,
            }}>
              <Icon name="ext" size={14} />
              <span>ayushnautiyaldevelopr@gmail.com</span>
            </a>
            <a href="tel:+918532949512" style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", background: "var(--card-2)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--fg)", textDecoration: "none", fontFamily: "inherit", fontSize: 13,
            }}>
              <Icon name="chat" size={14} />
              <span>+91 8532949512</span>
            </a>
          </div>
        </div>

        {/* Demo auto-login — uncomment when running your own server
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 8 }} className="mono">DEMO CREDENTIALS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ADMIN_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => { setEmail(a.email); setPassword(a.password); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", background: "var(--card-2)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  color: "var(--fg)", cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, textAlign: "left",
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: "linear-gradient(135deg, var(--accent), var(--accent-lo))",
                  display: "grid", placeItems: "center",
                  fontWeight: 600, fontSize: 10, color: "white",
                }}>
                  {a.tenantName[0]}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{a.tenantName}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{a.email}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>pw: demo</span>
              </button>
            ))}
          </div>
        </div>
        */}
      </div>
    </div>
  );
}
