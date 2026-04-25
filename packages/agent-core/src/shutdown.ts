// ── Process lifecycle (graceful shutdown) ──────────────────────────────────
//
// SIGINT  = Ctrl-C in a terminal
// SIGTERM = what Docker / k8s / process managers send to stop your process
//
// Without this, a Ctrl-C mid-tool-execution kills the process instantly and
// leaves the conversation in a weird half-state (tool call sent, no result).
// With this, the agent loop checks isShuttingDown() between iterations and
// exits cleanly on the next boundary.

// Private to this module — nothing outside gets to mutate it directly.
// That's the whole point: one file owns this piece of process state.
let shuttingDown = false;

// Read-only getter. Callers can check the flag but cannot flip it —
// only the signal handlers below can.
export function isShuttingDown(): boolean {
  return shuttingDown;
}

// Called once from the entry point (main.ts).
// Split out so we don't install handlers as a side effect of importing.
export function registerShutdownHandlers(): void {
  process.on("SIGINT", () => {
    // Second Ctrl-C = user is impatient, force-kill immediately.
    if (shuttingDown) process.exit(1);
    console.log("\n\x1b[33m[agent] Caught SIGINT, finishing current step...\x1b[0m");
    shuttingDown = true;
  });

  process.on("SIGTERM", () => {
    console.log("\n\x1b[33m[agent] Caught SIGTERM, shutting down...\x1b[0m");
    shuttingDown = true;
  });
}
