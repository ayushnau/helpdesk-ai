export { messages, agentTurn, agentTurnStream, clearConversation, type AgentTurnResult, type AgentStreamEvent } from "./agent.js";
export { provider, pickProvider, providerFromClientKey } from "./config.js";
export { tools, executeTool, setActiveTenantId } from "./tools.js";
export { isShuttingDown, registerShutdownHandlers } from "./shutdown.js";
export { countTokens, compressIfNeeded, type MemoryState } from "./memory.js";
export {
  type TenantConfig,
  type ConversationContext,
  createConversationContext,
  getTenantConfig,
  setTenantConfig,
  invalidateTenantCache,
  logTokenUsage,
  getDailyTokenUsage,
  ensureSchema,
  getRedis,
  closeConnections,
} from "./tenant.js";
export {
  getOrCreateSession,
  saveSession,
  deleteSession,
  sessionCount,
} from "./session-store.js";

// Re-export types so consumers don't reach into providers/
export type {
  Provider,
  ProviderResponse,
  Message,
  ToolDef,
  ToolCall,
  TokenUsage,
  StreamEvent,
  OpenAICompatConfig,
} from "./providers/index.js";
export { createOpenAICompatProvider } from "./providers/index.js";

export type { ToolResult, ToolError, ToolErrorType } from "./tools.js";
