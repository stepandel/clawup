/**
 * agent-army validate — Health check agents via Tailscale SSH
 *
 * This command wraps the platform-agnostic validateTool with the CLI adapter.
 */

import { validateTool, createCLIAdapter, type ValidateOptions } from "../tools";

export async function validateCommand(opts: ValidateOptions): Promise<void> {
  await validateTool(createCLIAdapter(), opts);
}
