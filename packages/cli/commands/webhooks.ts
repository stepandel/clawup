/**
 * clawup webhooks setup — Configure Linear webhooks for deployed agents
 *
 * This command wraps the platform-agnostic webhooksSetupTool with the CLI adapter.
 */

import { webhooksSetupTool, createCLIAdapter, type WebhooksSetupOptions } from "../tools";

export async function webhooksSetupCommand(opts: WebhooksSetupOptions): Promise<void> {
  await webhooksSetupTool(createCLIAdapter(), opts);
}
