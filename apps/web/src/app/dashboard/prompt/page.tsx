"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Btn, Card, PageHeader, Badge, Mono } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ChatSurface, useChat } from "@/components/chat-widget";
import { useAuth } from "@/components/auth-provider";
import { getTenantConfig, updateTenantConfig } from "@/lib/api";
import { systemPrompt as fallbackPrompt, fmtRelative } from "@/lib/data";

// ── Prompt history stored in localStorage ───────────────────────────────────
type PromptVersion = {
  id: number;
  prompt: string;
  savedAt: string; // ISO string
  chars: number;
};

function getPromptHistory(tenantId: string): PromptVersion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`prompt-history:${tenantId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePromptHistory(tenantId: string, prompt: string) {
  const history = getPromptHistory(tenantId);
  // Don't save if identical to the last version
  if (history.length > 0 && history[0].prompt === prompt) return;
  const version: PromptVersion = {
    id: (history[0]?.id || 0) + 1,
    prompt,
    savedAt: new Date().toISOString(),
    chars: prompt.length,
  };
  // Keep last 20 versions
  const updated = [version, ...history].slice(0, 20);
  localStorage.setItem(`prompt-history:${tenantId}`, JSON.stringify(updated));
}

// ── History Modal ───────────────────────────────────────────────────────────
function HistoryModal({ tenantId, onRestore, onClose }: {
  tenantId: string;
  onRestore: (prompt: string) => void;
  onClose: () => void;
}) {
  const history = getPromptHistory(tenantId);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }} onClick={onClose}>
      <div
        className="card"
        style={{ width: "100%", maxWidth: 640, height: "70vh", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Prompt history</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
              {history.length} version{history.length !== 1 ? "s" : ""} · {tenantId}
            </div>
          </div>
          <Btn kind="ghost" size="sm" icon="x" onClick={onClose} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {history.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No history yet. Save a prompt to start tracking versions.
            </div>
          ) : (
            history.map((v, i) => (
              <div
                key={v.id}
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", gap: 12, alignItems: "flex-start",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Badge kind={i === 0 ? "success" : "neutral"} mono>
                      v{v.id}
                    </Badge>
                    <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
                      {fmtRelative(new Date(v.savedAt))} · {v.chars} chars
                    </span>
                    {i === 0 && <span className="mono" style={{ fontSize: 10, color: "var(--success)" }}>current</span>}
                  </div>
                  <pre style={{
                    fontSize: 11, color: "var(--fg-2)",
                    margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                    maxHeight: 80, overflow: "hidden",
                    fontFamily: "var(--font-mono)",
                  }}>
                    {v.prompt.slice(0, 200)}{v.prompt.length > 200 ? "..." : ""}
                  </pre>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <Btn kind="ghost" size="sm" icon="copy" onClick={() => {
                    navigator.clipboard.writeText(v.prompt);
                  }} title="Copy this version" />
                  {i !== 0 && (
                    <Btn kind="ghost" size="sm" icon="arrowL" onClick={() => {
                      onRestore(v.prompt);
                      onClose();
                    }} title="Restore this version">
                      Restore
                    </Btn>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function PromptPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "posthog";

  const [prompt, setPrompt] = useState(fallbackPrompt);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState(new Date(Date.now() - 8 * 60_000));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const chat = useChat({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const config = await getTenantConfig(tenantId);
        if (cancelled) return;
        if (config?.systemPrompt) {
          setPrompt(config.systemPrompt);
        }
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const onChange = (v: string) => { setPrompt(v); setSaved(false); setSaveError(null); };

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateTenantConfig(tenantId, { systemPrompt: prompt });
      savePromptHistory(tenantId, prompt);
      setSaved(true);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(prompt);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, [prompt]);

  const onRestore = (restoredPrompt: string) => {
    setPrompt(restoredPrompt);
    setSaved(false);
  };

  const versionCount = getPromptHistory(tenantId).length;

  const editor = (
    <Card noPad>
      <div className="prompt-hd">
        <div className="prompt-hd-l">
          <div className="prompt-hd-title">System prompt</div>
          <div className="prompt-hd-sub mono">
            {loading
              ? <>Loading...</>
              : saveError
              ? <><span className="warning-dot" /> {saveError}</>
              : saved
              ? <><span className="success-dot" /> Saved {fmtRelative(savedAt)} · v{versionCount || 1} · live in production</>
              : <><span className="warning-dot" /> Unsaved changes</>
            }
          </div>
        </div>
        <div className="prompt-hd-r">
          <Btn kind="ghost" size="sm" icon="copy" onClick={onCopy}>
            {copyFeedback ? "Copied!" : "Copy"}
          </Btn>
          <Btn kind="ghost" size="sm" icon="filter" onClick={() => setShowHistory(true)}>
            History{versionCount > 0 ? ` (${versionCount})` : ""}
          </Btn>
          <Btn kind="primary" size="sm" disabled={saved || saving} onClick={onSave}>
            {saving ? "Saving..." : saved ? "Saved" : "Save & deploy"}
          </Btn>
        </div>
      </div>
      <div className="prompt-meta mono">
        <span>{prompt.length} chars</span>
        <span>·</span>
        <span>~{Math.ceil(prompt.length / 4)} tokens</span>
        <span>·</span>
        <span>{tenantId}</span>
      </div>
      <textarea
        className="prompt-editor mono"
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        disabled={loading}
      />
      <div className="prompt-foot">
        <div className="prompt-vars">
          <div className="prompt-vars-h mono">AVAILABLE VARIABLES</div>
          <div className="prompt-vars-list">
            <code>{"{user.distinct_id}"}</code>
            <code>{"{user.email}"}</code>
            <code>{"{tenant.name}"}</code>
            <code>{"{date.today}"}</code>
            <code>{"{conversation.turn_count}"}</code>
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="page page-no-scroll">
      <PageHeader
        eyebrow="Prompt"
        title="System prompt"
        sub="Edit on the left, watch behavior change on the right. Changes deploy instantly."
        actions={
          <>
            <Btn kind="ghost" size="sm" icon="filter" onClick={() => setShowHistory(true)}>
              History{versionCount > 0 ? ` (${versionCount})` : ""}
            </Btn>
            <Btn kind="primary" size="sm" disabled={saved || saving} onClick={onSave}>
              {saving ? "Saving..." : saved ? "Saved" : "Save & deploy"}
            </Btn>
          </>
        }
      />
      <div className="split-view">
        <div className="split-l">{editor}</div>
        <div className="split-r">
          <div className="preview-frame preview-frame-tall">
            <div className="preview-frame-hd">
              <div>
                <div className="preview-frame-title">Live preview</div>
                <div className="preview-frame-sub mono">applying current draft · session ephemeral</div>
              </div>
              <Btn kind="ghost" size="sm" icon="x" onClick={() => chat.reset()}>New</Btn>
            </div>
            <ChatSurface
              state={chat}
              density="compact"
              showTokens
              emptyTitle="Try a question"
              emptySubtitle="Responses use your unsaved draft."
              suggestions={[
                "How do I create a feature flag?",
                "What does the SDK cost?",
                "Help me debug session replay",
              ]}
            />
          </div>
        </div>
      </div>
      {showHistory && (
        <HistoryModal tenantId={tenantId} onRestore={onRestore} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
