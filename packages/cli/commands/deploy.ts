/**
 * clawup deploy — Deploy agents with pulumi up
 *
 * This command wraps the platform-agnostic deployTool with the CLI adapter.
 */

import { deployTool, createCLIAdapter, type DeployOptions } from "../tools";

export async function deployCommand(opts: DeployOptions): Promise<void> {
  await deployTool(createCLIAdapter(), opts);
}
