/**
 * agent-army ssh — SSH to agent by name/alias
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { getConfig, selectOrCreateStack } from "../lib/pulumi";
import { AGENT_ALIASES, SSH_USER } from "../lib/constants";
import { showBanner, exitWithError } from "../lib/ui";
import { spawn } from "child_process";

interface SshOptions {
  user?: string;
}

export async function sshCommand(agentNameOrAlias: string, commandArgs: string[], opts: SshOptions): Promise<void> {
  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
  }

  // Select stack
  const stackResult = selectOrCreateStack(manifest.stackName);
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
  const tailnetDnsName = getConfig("tailnetDnsName");
  if (!tailnetDnsName) {
    exitWithError("Could not determine tailnet DNS name from Pulumi config.");
  }

  const sshHost = `${agent.name}.${tailnetDnsName}`;
  const user = opts.user ?? SSH_USER;

  p.log.info(`Connecting to ${agent.displayName} (${sshHost})...`);

  // Build SSH command
  const sshArgs = ["-o", "StrictHostKeyChecking=no", `${user}@${sshHost}`];

  if (commandArgs.length > 0) {
    sshArgs.push(commandArgs.join(" "));
  }

  // Spawn interactive SSH
  const child = spawn("ssh", sshArgs, { stdio: "inherit" });
  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
