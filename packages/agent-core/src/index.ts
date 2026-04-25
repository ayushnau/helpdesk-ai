export { messages, agentTurn, clearConversation } from "./agent.js";
export { provider, pickProvider } from "./config.js";
export { tools, executeTool } from "./tools.js";
export { isShuttingDown, registerShutdownHandlers } from "./shutdown.js";

// Re-export types so consumers don't reach into providers/
export type {
  Provider,
  ProviderResponse,
  Message,
  ToolDef,
  ToolCall,
  TokenUsage,
  OpenAICompatConfig,
} from "./providers/index.js";
export { createOpenAICompatProvider } from "./providers/index.js";

export type { ToolResult, ToolError, ToolErrorType } from "./tools.js";
