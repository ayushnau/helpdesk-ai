"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authLogin, authSignup } from "@/lib/api";
import { Logo } from "@/components/ui";
import { Icon } from "@/components/icons";

const DEMO_ACCOUNTS = [
  { email: "marius@posthog.com", password: "demo", tenantName: "PostHog" },
  { email: "admin@acme.com", password: "demo", tenantName: "Acme Corp" },
];

export default function LoginPage() {
  const { login, isLoggedIn } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"signin" | "signup">("signin");

  // Sign in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Sign up
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [companyName, setCompanyName] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn) router.replace("/dashboard");
  }, [isLoggedIn, router]);

  const handleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authLogin({ email: email.trim(), password });
      if (!res.ok) { setError(res.error || "Login failed"); return; }
      login(res.user.tenantId, res.user.tenantName, res.user.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setError("");
    if (signupPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const res = await authSignup({
        email: signupEmail.trim(),
        password: signupPassword,
        name: signupName.trim(),
        companyName: companyName.trim(),
      });
      if (!res.ok) { setError(res.error || "Signup failed"); return; }
      login(res.user.tenantId, res.user.tenantName, res.user.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (tab === "signin") handleSignIn();
      else handleSignUp();
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, color: "var(--fg-2)", display: "block", marginBottom: 6,
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 500,
    background: active ? "var(--card-2)" : "transparent",
    color: active ? "var(--fg)" : "var(--fg-3)",
    border: active ? "1px solid var(--border)" : "1px solid transparent",
    borderRadius: "var(--radius-sm)", cursor: "pointer",
    fontFamily: "inherit", transition: "all 0.15s",
  });

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--bg)", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex" }}><Logo size={24} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 16, marginBottom: 4 }}>helpdesk.ai</h1>
          <p style={{ color: "var(--fg-3)", fontSize: 13, margin: 0 }}>Multi-tenant AI support agent</p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 4, padding: 4,
          background: "var(--card)", borderRadius: "var(--radius-sm)", marginBottom: 16,
        }}>
          <button style={tabBtnStyle(tab === "signin")} onClick={() => { setTab("signin"); setError(""); }}>Sign in</button>
          <button style={tabBtnStyle(tab === "signup")} onClick={() => { setTab("signup"); setError(""); }}>Sign up</button>
        </div>

        {/* Sign in */}
        {tab === "signin" && (
          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email</label>
              <input className="text-input" type="email" placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} autoFocus />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Password</label>
              <input className="text-input" type="password" placeholder="Enter password"
                value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey} />
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--error)", background: "var(--error-faint)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 16 }}>{error}</div>}
            <button className="btn btn-primary btn-md" style={{ width: "100%" }}
              disabled={!email.trim() || !password || loading} onClick={handleSignIn}>
              {loading ? "Signing in..." : "Sign in"} {!loading && <Icon name="arrow" size={14} />}
            </button>
          </div>
        )}

        {/* Sign up */}
        {tab === "signup" && (
          <div className="card" style={{ padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Your name</label>
              <input className="text-input" type="text" placeholder="Jane Smith"
                value={signupName} onChange={(e) => setSignupName(e.target.value)} onKeyDown={onKey} autoFocus />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Company name</label>
              <input className="text-input" type="text" placeholder="Acme Inc."
                value={companyName} onChange={(e) => setCompanyName(e.target.value)} onKeyDown={onKey} />
              <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 4 }}>
                This creates a new tenant workspace for your company.
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email</label>
              <input className="text-input" type="email" placeholder="you@company.com"
                value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} onKeyDown={onKey} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Password</label>
              <input className="text-input" type="password" placeholder="Min. 6 characters"
                value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} onKeyDown={onKey} />
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--error)", background: "var(--error-faint)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 16 }}>{error}</div>}
            <button className="btn btn-primary btn-md" style={{ width: "100%" }}
              disabled={!signupName.trim() || !signupEmail.trim() || !signupPassword || !companyName.trim() || loading} onClick={handleSignUp}>
              {loading ? "Creating account..." : "Create account"} {!loading && <Icon name="arrow" size={14} />}
            </button>
          </div>
        )}

        {/* Demo credentials */}
        {tab === "signin" && (
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 8 }} className="mono">DEMO CREDENTIALS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} onClick={() => { setEmail(a.email); setPassword(a.password); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", background: "var(--card-2)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", fontSize: 12, textAlign: "left",
                  }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: "linear-gradient(135deg, var(--accent), var(--accent-lo))",
                    display: "grid", placeItems: "center", fontWeight: 600, fontSize: 10, color: "white",
                  }}>{a.tenantName[0]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{a.tenantName}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{a.email}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>pw: demo</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, padding: "16px 0", borderTop: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 12 }}>
            Built by <strong style={{ color: "var(--fg-2)" }}>Ayush Nautiyal</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <a href="mailto:ayushnautiyaldevelopr@gmail.com" style={{ fontSize: 12, color: "var(--accent-hi)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="ext" size={12} /> Email
            </a>
            <span style={{ color: "var(--fg-5)" }}>·</span>
            <a href="tel:+918532949512" style={{ fontSize: 12, color: "var(--accent-hi)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="chat" size={12} /> +91 8532949512
            </a>
            <span style={{ color: "var(--fg-5)" }}>·</span>
            <a href="https://github.com/ayushnau/helpdesk-ai" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent-hi)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="ext" size={12} /> GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
