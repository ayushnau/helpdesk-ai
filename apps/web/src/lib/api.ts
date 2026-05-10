const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Read user-provided LLM API key from localStorage
function getLLMHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const geminiKey = localStorage.getItem("helpdesk-gemini-key");
  const groqKey = localStorage.getItem("helpdesk-groq-key");
  const headers: Record<string, string> = {};
  if (geminiKey) headers["X-Gemini-Key"] = geminiKey;
  if (groqKey) headers["X-Groq-Key"] = groqKey;
  return headers;
}

// ── Auth API ───────────────────────────────────────────────────────────────

export async function authSignup(data: { email: string; password: string; name: string; companyName: string }) {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function authLogin(data: { email: string; password: string }) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ── Chat API ───────────────────────────────────────────────────────────────

export async function sendMessageStream(
  message: string,
  tenantId: string,
  sessionId: string,
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void,
) {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": tenantId,
      "X-Session-ID": sessionId,
      ...getLLMHeaders(),
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7);
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent({ type: currentEvent, data });
        } catch {}
        currentEvent = "";
      }
    }
  }
}

export async function sendMessage(message: string, tenantId: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": tenantId,
      "X-Session-ID": sessionId,
      ...getLLMHeaders(),
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function clearSession(tenantId: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/chat/session`, {
    method: "DELETE",
    headers: { "X-Tenant-ID": tenantId, "X-Session-ID": sessionId },
  });
  return res.json();
}

export async function getHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

// ── Admin API ───────────────────────────────────────────────────────────────

export async function getUsage(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/usage?tenant_id=${tenantId}`);
  return res.json();
}

export async function getSessions(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/sessions?tenant_id=${tenantId}`);
  return res.json();
}

export async function getConversation(sessionId: string) {
  const res = await fetch(`${API_BASE}/admin/conversations/${sessionId}`);
  return res.json();
}

export async function getTenantConfig(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/tenant/${tenantId}`);
  return res.json();
}

export async function updateTenantConfig(tenantId: string, data: { systemPrompt?: string; maxTokensPerDay?: number }) {
  const res = await fetch(`${API_BASE}/admin/tenant`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId, ...data }),
  });
  return res.json();
}

export async function getKnowledge(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/knowledge?tenant_id=${tenantId}`);
  return res.json();
}

export async function uploadKnowledge(tenantId: string, files: FileList) {
  const formData = new FormData();
  formData.append("tenant_id", tenantId);
  for (let i = 0; i < files.length; i++) {
    formData.append("files", files[i]);
  }
  const res = await fetch(`${API_BASE}/admin/knowledge/upload`, {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export async function deleteKnowledge(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/knowledge?tenant_id=${tenantId}`, {
    method: "DELETE",
  });
  return res.json();
}

export async function reindexKnowledge(tenantId: string) {
  const res = await fetch(`${API_BASE}/admin/knowledge/reindex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  return res.json();
}
