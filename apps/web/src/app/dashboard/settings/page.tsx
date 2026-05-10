"use client";

import React, { useState, useEffect } from "react";
import { Btn, Card, Badge, Empty, PageHeader, FormRow, Mono } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { getTenantConfig, updateTenantConfig } from "@/lib/api";
import { apiKeys, fmtRelative } from "@/lib/data";

function SettingsGeneral() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "tn_demo";
  const tenantName = auth?.tenantName || "Demo";

  return (
    <Card>
      <div className="card-title" style={{ marginBottom: 4 }}>General</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>Identity and basics for this tenant.</div>
      <FormRow label="Tenant name" hint="Shown in the agent's responses if you reference {tenant.name}.">
        <input className="text-input" defaultValue={tenantName} />
      </FormRow>
      <FormRow label="Tenant ID" hint="Use this in API requests.">
        <div className="readonly-input"><Mono>{tenantId}</Mono><Btn kind="ghost" size="sm" icon="copy">Copy</Btn></div>
      </FormRow>
      <FormRow label="Default locale" hint="Falls back when conversation locale can't be detected.">
        <select className="text-input"><option>en-US</option><option>en-GB</option><option>de-DE</option></select>
      </FormRow>
      <FormRow label="Brand color" hint="Used in the embedded widget.">
        <div className="color-input"><span className="color-swatch" style={{ background: "#1d4aff" }} /><Mono>#1d4aff</Mono></div>
      </FormRow>
      <div className="form-actions"><Btn kind="primary" size="sm">Save changes</Btn></div>
    </Card>
  );
}

function SettingsLimits() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "tn_demo";

  const [maxTokens, setMaxTokens] = useState(80000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const config = await getTenantConfig(tenantId);
        if (cancelled) return;
        if (typeof config?.maxTokensPerDay === "number") {
          setMaxTokens(config.maxTokensPerDay);
        }
      } catch {
        // Keep default
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const onSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await updateTenantConfig(tenantId, { maxTokensPerDay: maxTokens });
      setSaveStatus("Saved");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="card-title" style={{ marginBottom: 4 }}>Limits & budget</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>Hard caps prevent runaway costs. The agent gracefully refuses once exceeded.</div>
      <FormRow label="Daily token cap" hint="Hard limit. Resets at 00:00 UTC.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="text-input"
            value={loading ? "" : maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value) || 0)}
            disabled={loading}
            style={{ width: 120 }}
          />
          <span className="mono dim">tokens / day</span>
          {saveStatus && <span className="mono dim">{saveStatus}</span>}
        </div>
      </FormRow>
      <FormRow label="Per-session cap" hint="Max turns before the agent stops responding in a single conversation.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="text-input" defaultValue="20" style={{ width: 80 }} />
          <span className="mono dim">turns</span>
        </div>
      </FormRow>
      <FormRow label="Rate limit" hint="Throttle per anonymous IP.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="text-input" defaultValue="30" style={{ width: 80 }} />
          <span className="mono dim">/ min</span>
        </div>
      </FormRow>
      <FormRow label="Soft warning at" hint="Email alert when usage approaches the daily cap.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="text-input" defaultValue="80" style={{ width: 80 }} />
          <span className="mono dim">% of cap</span>
        </div>
      </FormRow>
      <div className="form-actions">
        <Btn kind="primary" size="sm" disabled={saving} onClick={onSave}>
          {saving ? "Saving..." : "Save changes"}
        </Btn>
      </div>
    </Card>
  );
}

function SettingsKeys() {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string) => { setCopied(id); setTimeout(() => setCopied(null), 1200); };
  return (
    <Card>
      <div className="card-hd">
        <div>
          <div className="card-title">API keys</div>
          <div className="card-sub">Server-side keys for the helpdesk.ai API. Treat them like passwords.</div>
        </div>
        <Btn kind="primary" size="sm" icon="plus">Create key</Btn>
      </div>
      <div className="key-list">
        {apiKeys.map((k) => (
          <div className="key-item" key={k.id}>
            <div>
              <div className="key-label">{k.label} <Badge kind={k.env === "production" ? "warning" : "neutral"} mono>{k.env}</Badge></div>
              <div className="key-meta mono">created {fmtRelative(k.created)} · last used {fmtRelative(k.lastUsed)}</div>
            </div>
            <div className="key-token mono">
              {revealed[k.id] ? k.token : "•••••••••••••••••••••••" + k.token.slice(-4)}
              <Btn kind="ghost" size="sm" onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))}>
                {revealed[k.id] ? "Hide" : "Reveal"}
              </Btn>
              <Btn kind="ghost" size="sm" icon="copy" onClick={() => copy(k.id)}>{copied === k.id ? "Copied" : "Copy"}</Btn>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsModel() {
  const [geminiKey, setGeminiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("helpdesk-gemini-key") || "";
  });
  const [groqKey, setGroqKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("helpdesk-groq-key") || "";
  });
  const [keySaved, setKeySaved] = useState(false);

  const saveKeys = () => {
    localStorage.setItem("helpdesk-gemini-key", geminiKey.trim());
    localStorage.setItem("helpdesk-groq-key", groqKey.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  return (
    <Card>
      <div className="card-title" style={{ marginBottom: 4 }}>Model & API keys</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>Configure the LLM provider. Keys are stored in your browser only — never sent to our servers.</div>

      <FormRow label="Gemini API key" hint="Get one free at ai.google.dev. Used for both chat and embeddings.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="text-input"
            type="password"
            placeholder="AIza..."
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </FormRow>
      <FormRow label="Groq API key" hint="Optional. Get one at console.groq.com.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="text-input"
            type="password"
            placeholder="gsk_..."
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </FormRow>
      <div className="form-actions">
        <Btn kind="primary" size="sm" onClick={saveKeys}>
          {keySaved ? "Saved!" : "Save keys"}
        </Btn>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 20 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>Model selection</div>
        <div className="card-sub" style={{ marginBottom: 16 }}>Configured on the server via LLM_PROVIDER env var or CLI arg.</div>
      </div>
      <FormRow label="Primary model" hint="Set by server configuration.">
        <select className="text-input"><option>gemini-2.5-flash-lite</option><option>llama-3.3-70b-versatile</option><option>qwen2.5:7b (Ollama)</option></select>
      </FormRow>
      <FormRow label="Temperature">
        <input type="range" min="0" max="1" step="0.05" defaultValue="0.2" style={{ width: 200 }} />
      </FormRow>
      <div className="tools-list">
        <div className="tools-h mono">ENABLED TOOLS</div>
        {[
          { name: "search_knowledge_base", on: true, desc: "Vector search over indexed docs." },
          { name: "web_fetch", on: true, desc: "Fetch a URL and extract text." },
          { name: "lookup_status_page", on: true, desc: "Read your statuspage.io for outages." },
          { name: "create_support_ticket", on: false, desc: "Open a Linear/Zendesk issue. Coming soon." },
        ].map((t) => (
          <div className="tool-item" key={t.name}>
            <div>
              <div className="tool-name mono">{t.name}</div>
              <div className="tool-desc">{t.desc}</div>
            </div>
            <div className={`pill-toggle ${t.on ? "pill-on" : ""}`}><i /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsWebhooks() {
  return (
    <Card>
      <div className="card-title" style={{ marginBottom: 4 }}>Webhooks</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>Send events to your stack on conversation lifecycle.</div>
      <Empty title="No webhooks yet" sub="Get notified when conversations start, escalate, or resolve."
             action={<Btn kind="primary" size="sm" icon="plus">Add webhook</Btn>} />
    </Card>
  );
}

function SettingsTeam() {
  return (
    <Card>
      <div className="card-hd">
        <div>
          <div className="card-title">Team</div>
          <div className="card-sub">Invite teammates to view conversations and edit prompts.</div>
        </div>
        <Btn kind="primary" size="sm" icon="plus">Invite</Btn>
      </div>
      <div className="team-list">
        {[
          { name: "Marius Andra", email: "marius@posthog.com", role: "Owner" },
          { name: "Tim Glaser", email: "tim@posthog.com", role: "Admin" },
          { name: "James Greenhill", email: "james@posthog.com", role: "Editor" },
          { name: "Eric Duong", email: "eric@posthog.com", role: "Viewer" },
        ].map((m, i) => (
          <div className="team-item" key={i}>
            <div className="team-avatar">{m.name.split(" ").map(p => p[0]).join("")}</div>
            <div className="team-main">
              <div className="team-name">{m.name}</div>
              <div className="team-email mono">{m.email}</div>
            </div>
            <Badge kind="neutral">{m.role}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsBilling() {
  return (
    <Card>
      <div className="card-title" style={{ marginBottom: 4 }}>Billing</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>You&apos;re on the <strong>Scale</strong> plan · $499/mo · billed monthly.</div>
      <div className="billing-row">
        <div>
          <div className="billing-l">This period</div>
          <div className="billing-v mono">$487.20<span className="dim"> of $1500.00 included</span></div>
        </div>
        <Btn kind="secondary" size="sm">Manage plan</Btn>
      </div>
      <div className="usage-bar" style={{ marginTop: 16 }}>
        <div className="usage-bar-fill" style={{ width: "32%" }} />
      </div>
    </Card>
  );
}

function SettingsDanger() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "tn_demo";

  return (
    <Card style={{ borderColor: "var(--error-faint)" }}>
      <div className="card-title" style={{ color: "var(--error)", marginBottom: 4 }}>Danger zone</div>
      <div className="card-sub" style={{ marginBottom: 20 }}>Irreversible. We&apos;ll ask twice.</div>
      <FormRow label="Reset all conversations" hint="Wipe transcript history. Active sessions will be terminated.">
        <Btn kind="danger" size="sm" disabled title="Coming soon">Reset</Btn>
      </FormRow>
      <FormRow label="Delete tenant" hint="Removes the tenant and all associated data within 24 hours.">
        <Btn kind="danger" size="sm" disabled title="Coming soon">Delete {tenantId}</Btn>
      </FormRow>
    </Card>
  );
}

export default function SettingsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "tn_demo";

  // Read ?tab= from URL to allow deep linking (e.g. from chat banner)
  const [section, setSection] = useState(() => {
    if (typeof window === "undefined") return "general";
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "general";
  });

  return (
    <div className="page">
      <PageHeader eyebrow="Settings" title="Tenant configuration" sub={`Configure limits, API keys, and integrations for ${tenantId}.`} />
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            { id: "general", label: "General" },
            { id: "limits", label: "Limits & budget" },
            { id: "keys", label: "API keys" },
            { id: "model", label: "Model & tools" },
            { id: "webhooks", label: "Webhooks" },
            { id: "team", label: "Team" },
            { id: "billing", label: "Billing" },
            { id: "danger", label: "Danger zone", danger: true },
          ].map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${section === s.id ? "active" : ""} ${s.danger ? "danger" : ""}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === "general" && <SettingsGeneral />}
          {section === "limits" && <SettingsLimits />}
          {section === "keys" && <SettingsKeys />}
          {section === "model" && <SettingsModel />}
          {section === "webhooks" && <SettingsWebhooks />}
          {section === "team" && <SettingsTeam />}
          {section === "billing" && <SettingsBilling />}
          {section === "danger" && <SettingsDanger />}
        </div>
      </div>
    </div>
  );
}
