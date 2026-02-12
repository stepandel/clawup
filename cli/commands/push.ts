/**
 * agent-army push — Live-update running agents via Tailscale SSH
 *
 * This command wraps the platform-agnostic pushTool with the CLI adapter.
 */

import { pushTool, createCLIAdapter, type PushOptions } from "../tools";

export async function pushCommand(opts: PushOptions): Promise<void> {
  await pushTool(createCLIAdapter(), opts);
}
