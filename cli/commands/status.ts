/**
 * agent-army status — Show agent statuses from stack outputs
 *
 * This command wraps the platform-agnostic statusTool with the CLI adapter.
 */

import { statusTool, createCLIAdapter, type StatusOptions } from "../tools";

export async function statusCommand(opts: StatusOptions): Promise<void> {
  await statusTool(createCLIAdapter(), opts);
}
