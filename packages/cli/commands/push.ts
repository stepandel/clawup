/**
 * agent-army push — Live-update running agents via Tailscale SSH
 *
 * This command wraps the platform-agnostic pushTool with the CLI adapter.
 */

import { pushTool, createCLIAdapter, type PushOptions } from "../tools";
import { exitWithError } from "../lib/ui";

export async function pushCommand(opts: PushOptions): Promise<void> {
  try {
    await pushTool(createCLIAdapter(), opts);
  } catch (err) {
    exitWithError(err instanceof Error ? err.message : String(err));
  }
}
