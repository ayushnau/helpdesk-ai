import { v4 as uuidv4 } from "uuid";

const SESSION_KEY = "helpdesk-session-id";
const TENANT_KEY = "helpdesk-tenant-id";
const AUTH_KEY = "helpdesk-auth";

// ── Auth state ──────────────────────────────────────────────────────────────

export type AuthState = {
  loggedIn: boolean;
  tenantId: string;
  tenantName: string;
  displayName: string;
};

export function getAuthState(): AuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    return parsed.loggedIn ? parsed : null;
  } catch {
    return null;
  }
}

export function setAuthState(state: AuthState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  localStorage.setItem(TENANT_KEY, state.tenantId);
}

export function clearAuthState(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(TENANT_KEY);
}

// ── Session ID ──────────────────────────────────────────────────────────────

// Each chat instance gets its own session ID — no localStorage sharing.
// This way multiple tabs/chat widgets don't collide.
export function createSessionId(): string {
  return uuidv4();
}

// Keep these for backward compat but they just generate new IDs now
export function getSessionId(): string {
  return uuidv4();
}

export function resetSessionId(): string {
  return uuidv4();
}

// ── Tenant ID ───────────────────────────────────────────────────────────────

export function getTenantId(): string {
  if (typeof window === "undefined") return "posthog";
  const auth = getAuthState();
  if (auth) return auth.tenantId;
  return localStorage.getItem(TENANT_KEY) || "posthog";
}
