/**
 * clawup ssh — SSH to agent by name/alias
 */

import * as p from "@clack/prompts";
import { requireResolvedManifest } from "../lib/config";
import { getConfig, selectOrCreateStack } from "../lib/pulumi";
import { SSH_USER, tailscaleHostname, dockerContainerName } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { exitWithError } from "../lib/ui";
import { requireTailscale } from "../lib/tailscale";
import { spawn } from "child_process";

interface SshOptions {
  user?: string;
  /** Connect to local Docker container */
  local?: boolean;
}

export async function sshCommand(agentNameOrAlias: string, commandArgs: string[], opts: SshOptions): Promise<void> {
  // Ensure workspace is set up (no-op in dev mode)
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    exitWithError(wsResult.error ?? "Failed to set up workspace.");
  }
  const cwd = getWorkspaceDir();

  // Load manifest (resolves agent fields from identities)
  let manifest;
  try {
    manifest = requireResolvedManifest();
  } catch (err) {
    exitWithError((err as Error).message);
  }

  // --local: override provider in memory, use separate stack
  if (opts.local) {
    manifest = { ...manifest, provider: "local" as const };
  }

  // Select stack
  const stackName = opts.local ? `${manifest.stackName}-local` : manifest.stackName;
  const stackResult = selectOrCreateStack(stackName, cwd);
  if (!stackResult.ok) {
    exitWithError(`Could not select Pulumi stack "${stackName}".`);
  }

  // Resolve agent name/alias
  const query = agentNameOrAlias.toLowerCase();
  const resolvedRole = query;

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

  // Local provider: use docker exec instead of SSH
  if (manifest.provider === "local") {
    const containerName = dockerContainerName(stackName, agent.name);
    const user = opts.user ?? SSH_USER;
    p.log.info(`Connecting to ${agent.displayName} (${containerName})...`);

    const dockerArgs = ["exec", "-it", "-u", user, containerName];
    if (commandArgs.length > 0) {
      dockerArgs.push("bash", "-c", commandArgs.join(" "));
    } else {
      dockerArgs.push("bash");
    }

    const child = spawn("docker", dockerArgs, { stdio: "inherit" });
    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  // Cloud providers: use Tailscale SSH
  requireTailscale();

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
