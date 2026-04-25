
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function registerShutdownHandlers(): void {
  process.on("SIGINT", () => {
    if (shuttingDown) process.exit(1); // section ctrl c signal hander
    console.log("\n\x1b[33m[agent] Caught SIGINT, finishing current step...\x1b[0m");
    shuttingDown = true;
  });

  process.on("SIGTERM", () => {
    console.log("\n\x1b[33m[agent] Caught SIGTERM, shutting down...\x1b[0m");
    shuttingDown = true;
  });
}
