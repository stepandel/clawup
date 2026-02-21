/**
 * clawup ssh — SSH to agent by name/alias
 */

import * as p from "@clack/prompts";
import { loadManifest, resolveConfigName } from "../lib/config";
import { getConfig, selectOrCreateStack } from "../lib/pulumi";
import { AGENT_ALIASES, SSH_USER, tailscaleHostname } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { showBanner, exitWithError } from "../lib/ui";
import { requireTailscale } from "../lib/tailscale";
import { spawn } from "child_process";

interface SshOptions {
  user?: string;
  config?: string;
}

export async function sshCommand(agentNameOrAlias: string, commandArgs: string[], opts: SshOptions): Promise<void> {
  requireTailscale();

  // Ensure workspace is set up (no-op in dev mode)
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    exitWithError(wsResult.error ?? "Failed to set up workspace.");
  }
  const cwd = getWorkspaceDir();

  // Resolve config name
  let configName: string;
  try {
    configName = resolveConfigName(opts.config);
  } catch (err) {
    exitWithError((err as Error).message);
  }

  // Load manifest
  const manifest = loadManifest(configName);
  if (!manifest) {
    exitWithError(`Config '${configName}' could not be loaded.`);
  }

  // Select stack
  const stackResult = selectOrCreateStack(manifest.stackName, cwd);
  if (!stackResult.ok) {
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Resolve agent name/alias
  const query = agentNameOrAlias.toLowerCase();
  const resolvedRole = AGENT_ALIASES[query] ?? query;

  // Find agent in manifest
  const agent = manifest.agents.find(
    (a) =>
      a.role === resolvedRole ||
      a.name === query ||
      a.name === `agent-${query}` ||
      a.displayName.toLowerCase() === query
  );

  if (!agent) {
    const validNames = manifest.agents
      .map((a) => `${a.role}, ${a.displayName.toLowerCase()}, ${a.name}`)
      .join("\n  ");
    exitWithError(
      `Unknown agent: "${agentNameOrAlias}"\nValid identifiers (any of these work):\n  ${validNames}`
    );
  }

  // Get tailnet DNS name
  const tailnetDnsName = getConfig("tailnetDnsName", cwd);
  if (!tailnetDnsName) {
    exitWithError("Could not determine tailnet DNS name from Pulumi config.");
  }

  const tsHost = tailscaleHostname(manifest.stackName, agent.name);
  const sshHost = `${tsHost}.${tailnetDnsName}`;
  const user = opts.user ?? SSH_USER;

  p.log.info(`Connecting to ${agent.displayName} (${sshHost})...`);

  // Build SSH command
  const sshArgs = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", `${user}@${sshHost}`];

  if (commandArgs.length > 0) {
    sshArgs.push(commandArgs.join(" "));
  }

  // Spawn interactive SSH
  const child = spawn("ssh", sshArgs, { stdio: "inherit" });
  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
