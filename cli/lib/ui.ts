/**
 * Shared UI helpers using @clack/prompts
 */

import * as p from "@clack/prompts";
import pc from "picocolors";

/**
 * Display the Agent Army banner
 */
export function showBanner(): void {
  console.log();
  p.intro(pc.bgCyan(pc.black(" Agent Army ")));
}

/**
 * Handle user cancellation (Ctrl+C)
 */
export function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
}

/**
 * Show an error and exit
 */
export function exitWithError(message: string): never {
  p.log.error(message);
  process.exit(1);
}

/**
 * Format a cost estimate string
 */
export function formatCost(monthlyCost: number): string {
  return `~$${monthlyCost}/mo`;
}

/**
 * Format agent list for display
 */
export function formatAgentList(agents: { displayName: string; role: string; identity: string }[]): string {
  return agents
    .map((a) => `  ${pc.bold(a.displayName)} (${a.role})`)
    .join("\n");
}
