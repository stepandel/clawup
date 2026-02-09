/**
 * agent-army destroy — Tear down resources with safety confirmations
 *
 * This command wraps the platform-agnostic destroyTool with the CLI adapter.
 */

import { destroyTool, createCLIAdapter, type DestroyOptions } from "../tools";

export async function destroyCommand(opts: DestroyOptions): Promise<void> {
  await destroyTool(createCLIAdapter(), opts);
}
