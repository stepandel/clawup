import type { PluginManifest, IdentityResult } from "@clawup/core";
import { redactSecretsFromString } from "./redact.js";

// NOTE: This helper intentionally takes a broad set of dependencies.
// setup.ts is already a large command; extracting this orchestration keeps the
// behavior identical while reducing file size.

type PromptLike = {
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  spinner: () => { start: (msg: string) => void; stop: (msg?: string) => void };
  text: (opts: {
    message: string;
    validate?: (val: string) => string | undefined;
  }) => Promise<string | symbol>;
  isCancel: (val: unknown) => boolean;
};

function envVarToCamel(envVar: string): string {
  return envVar
    .toLowerCase()
    .split("_")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export async function runOnboardHooks(args: {
  fetchedIdentities: Array<{
    agent: { name: string; role: string; displayName: string };
    identityResult: IdentityResult;
  }>;
  agentPlugins: Map<string, Set<string>>;
  resolvePlugin: (pluginName: string, identityResult: IdentityResult) => PluginManifest;
  autoResolvedSecrets: Record<string, Record<string, string>>;
  envDict: Record<string, string>;
  resolvedSecrets: { perAgent: Record<string, Record<string, string>> };
  p: PromptLike;
  runOnboardHook: (opts: { script: string; env: Record<string, string> }) => Promise<
    | { ok: true; instructions?: string }
    | { ok: false; error: string }
  >;
  exitWithError: (message: string) => never;
  skipOnboard: boolean;
}): Promise<void> {
  const {
    fetchedIdentities,
    agentPlugins,
    resolvePlugin,
    autoResolvedSecrets,
    envDict,
    resolvedSecrets,
    p,
    runOnboardHook,
    exitWithError,
    skipOnboard,
  } = args;

  if (skipOnboard) {
    p.log.info("Onboard hooks skipped. Use --onboard flag or run `clawup onboard` separately.");
    return;
  }

  for (const fi of fetchedIdentities) {
    const plugins = agentPlugins.get(fi.agent.name);
    if (!plugins) continue;

    for (const pluginName of plugins) {
      const pluginManifest = resolvePlugin(pluginName, fi.identityResult);
      const onboard = pluginManifest.hooks?.onboard;
      if (!onboard) continue;

      // runOnce: skip if all required secrets are already present
      if (onboard.runOnce) {
        const roleUpper = fi.agent.role.toUpperCase();
        const requiredSecrets = Object.entries(pluginManifest.secrets).filter(([, s]) => s.required);
        const allSecretsPresent =
          requiredSecrets.length > 0 &&
          requiredSecrets.every(([key, secret]) => {
            // Check auto-resolved secrets (stored by raw plugin key)
            if (autoResolvedSecrets[fi.agent.role]?.[key]) return true;
            // Check env dict using the plugin secret's envVar (prefixed with role)
            const envKey = `${roleUpper}_${secret.envVar}`;
            return !!envDict[envKey];
          });
        if (allSecretsPresent) {
          p.log.info(
            `Onboard hook for ${pluginName} (${fi.agent.displayName}): skipped (already configured)`
          );
          continue;
        }
      }

      p.log.info(
        `Running onboard hook for ${pluginName} (${fi.agent.displayName}): ${onboard.description}`
      );

      // Collect inputs — from env or interactive prompt
      const hookEnv: Record<string, string> = {};

      // Add existing resolved secrets to hook env
      const agentSecrets = resolvedSecrets.perAgent[fi.agent.name] ?? {};
      for (const [, sec] of Object.entries(pluginManifest.secrets)) {
        const envDerivedKey = envVarToCamel(sec.envVar);
        if (agentSecrets[envDerivedKey]) {
          hookEnv[sec.envVar] = agentSecrets[envDerivedKey];
        }
      }

      for (const [inputKey, input] of Object.entries(onboard.inputs)) {
        // Check env first
        const envValue = envDict[input.envVar] ?? envDict[`${fi.agent.role.toUpperCase()}_${input.envVar}`];
        if (envValue) {
          hookEnv[input.envVar] = envValue;
          continue;
        }

        // Interactive prompt
        if (input.instructions) {
          p.log.info(input.instructions);
        }
        const value = await p.text({
          message: input.prompt,
          validate: (val) => {
            if (!val) return `${inputKey} is required`;
            if (input.validator && !val.startsWith(input.validator)) {
              return `${inputKey} must start with "${input.validator}"`;
            }
            return undefined;
          },
        });

        if (p.isCancel(value)) {
          exitWithError("Onboard cancelled by user.");
        }

        hookEnv[input.envVar] = value as string;
      }

      const result = await runOnboardHook({ script: onboard.script, env: hookEnv });
      if (result.ok) {
        if (result.instructions) {
          const redacted = redactSecretsFromString(result.instructions);
          // Preserve the original behavior: blank line + label + instructions + blank line.
          console.log();
          p.log.info(`Follow-up instructions for ${pluginName}:`);
          console.log(redacted);
          console.log();
        }
      } else {
        p.log.error(`Onboard hook for ${pluginName} failed: ${result.error}`);
        exitWithError(
          "Onboard hook failed. Fix the issue and run `clawup setup --onboard` again, or run `clawup onboard` separately."
        );
      }
    }
  }
}
