/**
 * clawup setup — DEPRECATED
 *
 * `clawup deploy` now handles setup automatically.
 * This command is kept for backward compatibility (CI scripts, etc.)
 * and delegates to runSetup() from lib/setup.ts.
 */

import * as p from "@clack/prompts";
import { showBanner, exitWithError } from "../lib/ui";
import { runSetup, type SetupProgress } from "../lib/setup";

interface SetupCommandOptions {
  envFile?: string;
  deploy?: boolean;
  yes?: boolean;
  skipHooks?: boolean;
}

/** Build a SetupProgress adapter backed by @clack/prompts */
function clackProgress(): SetupProgress {
  return {
    spinner: () => {
      const s = p.spinner();
      return { start: (msg: string) => s.start(msg), stop: (msg: string) => s.stop(msg) };
    },
    log: {
      info: (msg: string) => p.log.info(msg),
      warn: (msg: string) => p.log.warn(msg),
      error: (msg: string) => p.log.error(msg),
      success: (msg: string) => p.log.success(msg),
    },
  };
}

export async function setupCommand(opts: SetupCommandOptions = {}): Promise<void> {
  showBanner();

  p.log.warn(
    "`clawup setup` is deprecated. `clawup deploy` now handles setup automatically.\n" +
    "  This command will be removed in a future version."
  );

  const result = await runSetup(clackProgress(), {
    envFile: opts.envFile,
    skipHooks: opts.skipHooks,
  });

  if (!result.ok) {
    exitWithError(result.error!);
    return;
  }

  if (opts.deploy) {
    p.log.success("Setup complete! Starting deployment...\n");
    const { deployCommand } = await import("./deploy.js");
    await deployCommand({ yes: opts.yes });
  } else {
    p.outro("Setup complete! Run `clawup deploy` to deploy your agents.");
  }
}
