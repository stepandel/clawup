/**
 * Push Tool — Live-update running agents via Tailscale SSH
 *
 * Syncs workspace files, skills, config, and OpenClaw updates to
 * running agent instances without redeploying infrastructure.
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import * as fs from "fs";
import * as path from "path";
import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { requireResolvedManifest } from "../lib/config";
import { SSH_USER, tailscaleHostname, dockerContainerName } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { getConfig, selectOrCreateStack, qualifiedStackName } from "../lib/pulumi";
import type { ResolvedAgent } from "@clawup/core";
import { fetchIdentitySync } from "@clawup/core/identity";
import { classifySkills } from "@clawup/core";
import { resolveDeps } from "@clawup/core";
import * as os from "os";
import pc from "picocolors";

export interface PushOptions {
  /** Sync skills to remote workspace */
  skills?: boolean;
  /** Sync workspace files to remote agents */
  workspace?: boolean;
  /** Remove remote memory/ dir and MEMORY.md */
  memoryReset?: boolean;
  /** Run npm install -g openclaw@latest + gateway restart */
  openclaw?: boolean;
  /** Copy local openclaw.json to remote + gateway restart */
  pushConfig?: boolean;
  /** Filter to a single agent (name, role, or alias) */
  agent?: string;
  /** Push to local Docker containers */
  local?: boolean;
}

/** SSH options for non-interactive connections */
const SSH_OPTS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "BatchMode=yes",
];

const REMOTE_WORKSPACE = `/home/${SSH_USER}/.openclaw/workspace`;
const REMOTE_SKILLS = `${REMOTE_WORKSPACE}/skills`;

/**
 * Run a command over SSH, returning success/failure and output.
 */
function sshExec(
  exec: ExecAdapter,
  host: string,
  command: string,
): { ok: boolean; output: string } {
  const result = exec.capture("ssh", [
    "-o", "ConnectTimeout=15",
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"${command.replace(/"/g, '\\"')}"`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Run rsync to sync a local directory to a remote path.
 */
function rsyncDir(
  exec: ExecAdapter,
  localDir: string,
  host: string,
  remoteDir: string,
): { ok: boolean; output: string } {
  // Ensure trailing slash on localDir so rsync syncs contents
  const src = localDir.endsWith("/") ? localDir : `${localDir}/`;
  const result = exec.capture("rsync", [
    "-avz", "--delete",
    "-e", `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes`,
    src,
    `${SSH_USER}@${host}:${remoteDir}/`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Copy a single file to a remote path via scp.
 */
function scpFile(
  exec: ExecAdapter,
  localFile: string,
  host: string,
  remotePath: string,
): { ok: boolean; output: string } {
  const result = exec.capture("scp", [
    ...SSH_OPTS,
    localFile,
    `${SSH_USER}@${host}:${remotePath}`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Run a command inside a Docker container, returning success/failure and output.
 */
function dockerExec(
  exec: ExecAdapter,
  containerName: string,
  command: string,
): { ok: boolean; output: string } {
  const escaped = command.replace(/"/g, '\\"');
  const result = exec.capture("docker", [
    "exec", containerName, "bash", "-c", `"${escaped}"`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Copy a local file into a Docker container.
 */
function dockerCp(
  exec: ExecAdapter,
  localFile: string,
  containerName: string,
  remotePath: string,
): { ok: boolean; output: string } {
  const result = exec.capture("docker", [
    "cp", localFile, `${containerName}:${remotePath}`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Sync a local directory into a Docker container (rm + cp).
 */
function dockerSyncDir(
  exec: ExecAdapter,
  localDir: string,
  containerName: string,
  remoteDir: string,
): { ok: boolean; output: string } {
  // Remove existing remote dir contents first
  exec.capture("docker", ["exec", containerName, "bash", "-c", `"rm -rf ${remoteDir}/*"`]);
  // Copy local dir into container
  const result = exec.capture("docker", [
    "cp", `${localDir}/.`, `${containerName}:${remoteDir}/`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Resolve an agent query (name, role, alias, displayName) against the manifest.
 */
function findAgent(agents: ResolvedAgent[], query: string): ResolvedAgent | undefined {
  const q = query.toLowerCase();
  const resolvedRole = q;
  return agents.find(
    (a) =>
      a.role === resolvedRole ||
      a.name === q ||
      a.name === `agent-${q}` ||
      a.displayName.toLowerCase() === q
  );
}

/**
 * Push tool implementation
 */
export const pushTool: ToolImplementation<PushOptions> = async (
  runtime: RuntimeAdapter,
  options: PushOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Clawup");

  // Ensure workspace is set up
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    throw new Error(wsResult.error ?? "Failed to set up workspace.");
  }
  const cwd = getWorkspaceDir();

  // Load manifest
  let manifest = requireResolvedManifest();

  // --local: override provider in memory, use separate stack
  if (options.local) {
    manifest = { ...manifest, provider: "local" as const };
  }

  // Select Pulumi stack to read tailnet config (use org-qualified name if organization is set)
  const stackName = options.local ? `${manifest.stackName}-local` : manifest.stackName;
  const pulumiStack = qualifiedStackName(stackName, manifest.organization);
  const stackResult = selectOrCreateStack(pulumiStack, cwd);
  if (!stackResult.ok) {
    throw new Error(`Could not select Pulumi stack "${pulumiStack}".`);
  }

  const isLocal = manifest.provider === "local";

  // Get tailnet DNS name (not needed for local)
  const tailnetDnsName = isLocal ? null : getConfig("tailnetDnsName", cwd);
  if (!isLocal && !tailnetDnsName) {
    throw new Error("Could not determine tailnet DNS name from Pulumi config.");
  }

  // Default behavior: if no flags are set, push skills + workspace
  const noFlags = !options.skills && !options.workspace && !options.memoryReset &&
    !options.openclaw && !options.pushConfig;
  const doSkills = options.skills || noFlags;
  const doWorkspace = options.workspace || noFlags;

  // Determine target agents
  let targetAgents = manifest.agents;
  if (options.agent) {
    const matched = findAgent(manifest.agents, options.agent);
    if (!matched) {
      const validNames = manifest.agents
        .map((a) => `${a.role}, ${a.displayName.toLowerCase()}, ${a.name}`)
        .join("\n  ");
      ui.log.error(
        `Unknown agent: "${options.agent}"\nValid identifiers:\n  ${validNames}`
      );
      return;
    }
    targetAgents = [matched];
  }

  // Describe what we're pushing
  const actions: string[] = [];
  if (doSkills) actions.push("skills");
  if (doWorkspace) actions.push("workspace");
  if (options.memoryReset) actions.push("memory-reset");
  if (options.openclaw) actions.push("openclaw upgrade");
  if (options.pushConfig) actions.push("config");

  ui.log.step(
    `Pushing [${actions.join(", ")}] to ${targetAgents.length} agent(s)...`
  );
  console.log();

  let allOk = true;

  for (const agent of targetAgents) {
    const containerName = isLocal ? dockerContainerName(stackName, agent.name) : "";
    const tsHost = isLocal ? "" : tailscaleHostname(manifest.stackName, agent.name);
    const host = isLocal ? containerName : `${tsHost}.${tailnetDnsName}`;

    // Helper wrappers that dispatch to Docker or SSH
    const remoteExec = (command: string) =>
      isLocal ? dockerExec(exec, containerName, command) : sshExec(exec, host, command);
    const remoteCp = (localFile: string, remotePath: string) =>
      isLocal ? dockerCp(exec, localFile, containerName, remotePath) : scpFile(exec, localFile, host, remotePath);
    const remoteSync = (localDir: string, remoteDir: string) =>
      isLocal ? dockerSyncDir(exec, localDir, containerName, remoteDir) : rsyncDir(exec, localDir, host, remoteDir);

    const displayHost = isLocal ? containerName : host;
    ui.log.info(`${pc.bold(agent.displayName)} (${agent.role}) — ${displayHost}`);

    let needsRestart = false;

    // 1. Push workspace files and skills (unified via identity system)
    if (doWorkspace || doSkills) {
      try {
        const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
        const identity = fetchIdentitySync(agent.identity, identityCacheDir);

        // Ensure remote workspace dir exists
        remoteExec(`mkdir -p ${REMOTE_WORKSPACE}`);

        // Write identity files to a temp dir for transfer
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-identity-"));

        for (const [relPath, content] of Object.entries(identity.files)) {
          const localFile = path.join(tmpDir, relPath);
          fs.mkdirSync(path.dirname(localFile), { recursive: true });
          fs.writeFileSync(localFile, content);
        }

        // Sync workspace files (non-skill files)
        if (doWorkspace) {
          const topFiles = Object.keys(identity.files).filter(f => !f.startsWith("skills/"));
          let wsOk = true;
          for (const relPath of topFiles) {
            const localFile = path.join(tmpDir, relPath);
            const result = remoteCp(localFile, `${REMOTE_WORKSPACE}/${relPath}`);
            if (!result.ok) {
              console.log(`    ${pc.red("FAIL")}  workspace file ${relPath}: ${result.output.substring(0, 100)}`);
              wsOk = false;
              allOk = false;
            }
          }
          if (wsOk) {
            console.log(`    ${pc.green("OK")}  workspace files synced (${topFiles.length} files)`);
          }
        }

        // Sync skills
        if (doSkills) {
          const skillsLocalDir = path.join(tmpDir, "skills");
          if (fs.existsSync(skillsLocalDir)) {
            remoteExec(`mkdir -p ${REMOTE_SKILLS}`);
            const result = remoteSync(skillsLocalDir, REMOTE_SKILLS);
            if (result.ok) {
              console.log(`    ${pc.green("OK")}  skills synced`);
            } else {
              console.log(`    ${pc.red("FAIL")}  skills sync failed: ${result.output.substring(0, 100)}`);
              allOk = false;
            }
          }

          // Install public skills via clawhub
          const { public: publicSkills } = classifySkills(identity.manifest.skills);
          for (const skill of publicSkills) {
            const cmd = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && clawhub install ${skill.slug}`;
            const result = remoteExec(cmd);
            if (result.ok) {
              console.log(`    ${pc.green("OK")}  clawhub skill installed: ${skill.slug}`);
            } else {
              console.log(`    ${pc.red("FAIL")}  clawhub skill ${skill.slug}: ${result.output.substring(0, 100)}`);
              allOk = false;
            }
          }

          // Run dep post-install scripts (e.g., gh auth)
          if (identity.manifest.deps?.length) {
            const resolved = resolveDeps(identity.manifest.deps);
            for (const dep of resolved) {
              if (!dep.entry.postInstallScript) continue;
              const cmd = dep.entry.postInstallScript;
              const result = remoteExec(cmd);
              if (result.ok) {
                console.log(`    ${pc.green("OK")}  dep post-install: ${dep.name}`);
              } else {
                console.log(`    ${pc.red("FAIL")}  dep post-install ${dep.name}: ${result.output.substring(0, 100)}`);
                allOk = false;
              }
            }
          }
        }

        // Cleanup temp dir
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        console.log(`    ${pc.red("FAIL")}  identity fetch failed: ${(err as Error).message}`);
        allOk = false;
      }
    }

    // 3. Memory reset
    if (options.memoryReset) {
      const cmd = `rm -rf ${REMOTE_WORKSPACE}/memory ${REMOTE_WORKSPACE}/MEMORY.md`;
      const result = remoteExec(cmd);
      if (result.ok) {
        console.log(`    ${pc.green("OK")}  memory reset`);
      } else {
        console.log(`    ${pc.red("FAIL")}  memory reset failed: ${result.output.substring(0, 100)}`);
        allOk = false;
      }
    }

    // 4. OpenClaw upgrade
    if (options.openclaw) {
      const cmd = `npm install -g openclaw@latest 2>&1`;
      const result = remoteExec(cmd);
      if (result.ok) {
        console.log(`    ${pc.green("OK")}  openclaw upgraded`);
        needsRestart = true;
      } else {
        console.log(`    ${pc.red("FAIL")}  openclaw upgrade failed: ${result.output.substring(0, 100)}`);
        allOk = false;
      }
    }

    // 5. Config push
    if (options.pushConfig) {
      const operatorConfig = path.join(
        process.env.HOME ?? "",
        ".openclaw",
        "openclaw.json"
      );
      if (fs.existsSync(operatorConfig)) {
        const result = remoteCp(
          operatorConfig,
          `/home/${SSH_USER}/.openclaw/openclaw.json`
        );
        if (result.ok) {
          console.log(`    ${pc.green("OK")}  openclaw.json pushed`);
          needsRestart = true;
        } else {
          console.log(`    ${pc.red("FAIL")}  config push failed: ${result.output.substring(0, 100)}`);
          allOk = false;
        }
      } else {
        console.log(`    ${pc.red("FAIL")}  local openclaw.json not found at ${operatorConfig}`);
        allOk = false;
      }
    }

    // 6. Restart gateway if needed
    if (needsRestart) {
      const restartCmd = isLocal
        ? "kill -HUP $(pgrep -f 'openclaw daemon') 2>/dev/null || true"
        : "systemctl --user restart openclaw-gateway";
      const result = remoteExec(restartCmd);
      if (result.ok) {
        console.log(`    ${pc.green("OK")}  gateway restarted`);
      } else {
        console.log(`    ${pc.red("FAIL")}  gateway restart failed: ${result.output.substring(0, 100)}`);
        allOk = false;
      }
    }

    console.log();
  }

  // Summary
  if (allOk) {
    ui.log.success(`Push completed successfully for ${targetAgents.length} agent(s).`);
  } else {
    ui.log.warn("Push completed with some failures. Check output above.");
    throw new Error("Push completed with failures.");
  }
};
