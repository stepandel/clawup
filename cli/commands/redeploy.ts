/**
 * agent-army redeploy — Update agents in-place without destroying infrastructure
 *
 * This command wraps the platform-agnostic redeployTool with the CLI adapter.
 */

import { redeployTool, createCLIAdapter, type RedeployOptions } from "../tools";

export async function redeployCommand(opts: RedeployOptions): Promise<void> {
  await redeployTool(createCLIAdapter(), opts);
}
