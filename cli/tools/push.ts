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
import { loadManifest, resolveConfigName } from "../lib/config";
import { AGENT_ALIASES, SSH_USER, tailscaleHostname } from "../lib/constants";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { getConfig, selectOrCreateStack } from "../lib/pulumi";
import type { AgentDefinition } from "../types";
import pc from "picocolors";

export interface PushOptions {
  /** Sync presets/skills/ to remote workspace */
  skills?: boolean;
  /** Sync role-specific preset files + base AGENTS.md to remote workspace */
  workspace?: boolean;
  /** Remove remote memory/ dir and MEMORY.md */
  memoryReset?: boolean;
  /** Run npm install -g openclaw@latest + gateway restart */
  openclaw?: boolean;
  /** Copy local openclaw.json to remote + gateway restart */
  pushConfig?: boolean;
  /** Filter to a single agent (name, role, or alias) */
  agent?: string;
  /** Config name (auto-detected if only one) */
  config?: string;
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
 * Resolve the presets directory.
 * Dev mode: repo root is 3 levels up from cli/dist/tools/
 * Installed mode: presets are bundled under cli/presets/ (via infra)
 */
function resolvePresetsDir(): string {
  // From cli/dist/tools/push.js → repo root → presets/
  const devPath = path.resolve(__dirname, "..", "..", "..", "presets");
  if (fs.existsSync(devPath)) return devPath;

  // Fallback: check next to the infra dir (installed mode)
  const installedPath = path.resolve(__dirname, "..", "..", "presets");
  if (fs.existsSync(installedPath)) return installedPath;

  throw new Error(
    `Presets directory not found. Searched:\n  ${devPath}\n  ${installedPath}`
  );
}

/**
 * Resolve an agent query (name, role, alias, displayName) against the manifest.
 */
function findAgent(agents: AgentDefinition[], query: string): AgentDefinition | undefined {
  const q = query.toLowerCase();
  const resolvedRole = AGENT_ALIASES[q] ?? q;
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

  ui.intro("Agent Army");

  // Ensure workspace is set up
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    ui.log.error(wsResult.error ?? "Failed to set up workspace.");
    process.exit(1);
  }
  const cwd = getWorkspaceDir();

  // Resolve config name and load manifest
  let configName: string;
  try {
    configName = resolveConfigName(options.config);
  } catch (err) {
    ui.log.error((err as Error).message);
    process.exit(1);
  }

  const manifest = loadManifest(configName);
  if (!manifest) {
    ui.log.error(`Config '${configName}' could not be loaded.`);
    process.exit(1);
  }

  // Select Pulumi stack to read tailnet config
  const stackResult = selectOrCreateStack(manifest.stackName, cwd);
  if (!stackResult.ok) {
    ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
    process.exit(1);
  }

  // Get tailnet DNS name
  const tailnetDnsName = getConfig("tailnetDnsName", cwd);
  if (!tailnetDnsName) {
    ui.log.error("Could not determine tailnet DNS name from Pulumi config.");
    process.exit(1);
  }

  // Default behavior: if no flags are set, push skills + workspace
  const noFlags = !options.skills && !options.workspace && !options.memoryReset &&
    !options.openclaw && !options.pushConfig;
  const doSkills = options.skills || noFlags;
  const doWorkspace = options.workspace || noFlags;

  // Resolve presets directory
  let presetsDir: string;
  try {
    presetsDir = resolvePresetsDir();
  } catch (err) {
    ui.log.error((err as Error).message);
    process.exit(1);
  }

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
      process.exit(1);
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
    const tsHost = tailscaleHostname(manifest.stackName, agent.name);
    const host = `${tsHost}.${tailnetDnsName}`;

    ui.log.info(`${pc.bold(agent.displayName)} (${agent.role}) — ${host}`);

    let needsRestart = false;

    // 1. Push skills
    if (doSkills) {
      const skillsDir = path.join(presetsDir, "skills");
      if (fs.existsSync(skillsDir)) {
        // Ensure remote skills dir exists
        sshExec(exec, host, `mkdir -p ${REMOTE_SKILLS}`);
        const result = rsyncDir(exec, skillsDir, host, REMOTE_SKILLS);
        if (result.ok) {
          console.log(`    ${pc.green("OK")}  skills synced`);
        } else {
          console.log(`    ${pc.red("FAIL")}  skills sync failed: ${result.output.substring(0, 100)}`);
          allOk = false;
        }
      } else {
        console.log(`    ${pc.yellow("SKIP")}  no skills directory found at ${skillsDir}`);
      }
    }

    // 2. Push workspace files (role-specific preset + base AGENTS.md)
    if (doWorkspace) {
      const presetName = agent.preset;
      if (presetName) {
        const roleDir = path.join(presetsDir, presetName);
        if (fs.existsSync(roleDir)) {
          // Ensure remote workspace dir exists
          sshExec(exec, host, `mkdir -p ${REMOTE_WORKSPACE}`);

          // Sync role-specific files (SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md, etc.)
          const roleFiles = fs.readdirSync(roleDir).filter(
            (f) => fs.statSync(path.join(roleDir, f)).isFile()
          );
          let wsOk = true;
          for (const file of roleFiles) {
            const localFile = path.join(roleDir, file);
            // Remove .tpl extension for remote name
            const remoteName = file.replace(/\.tpl$/, "");
            const result = scpFile(exec, localFile, host, `${REMOTE_WORKSPACE}/${remoteName}`);
            if (!result.ok) {
              console.log(`    ${pc.red("FAIL")}  workspace file ${file}: ${result.output.substring(0, 100)}`);
              wsOk = false;
              allOk = false;
            }
          }
          if (wsOk) {
            console.log(`    ${pc.green("OK")}  workspace files synced (${roleFiles.length} files from ${presetName}/)`);
          }
        } else {
          console.log(`    ${pc.yellow("SKIP")}  preset directory not found: ${roleDir}`);
        }

        // Sync base AGENTS.md
        const agentsMd = path.join(presetsDir, "base", "AGENTS.md");
        if (fs.existsSync(agentsMd)) {
          const result = scpFile(exec, agentsMd, host, `${REMOTE_WORKSPACE}/AGENTS.md`);
          if (result.ok) {
            console.log(`    ${pc.green("OK")}  AGENTS.md synced`);
          } else {
            console.log(`    ${pc.red("FAIL")}  AGENTS.md sync failed: ${result.output.substring(0, 100)}`);
            allOk = false;
          }
        }
      } else {
        console.log(`    ${pc.yellow("SKIP")}  no preset defined for ${agent.displayName} (custom agent)`);
      }
    }

    // 3. Memory reset
    if (options.memoryReset) {
      const cmd = `rm -rf ${REMOTE_WORKSPACE}/memory ${REMOTE_WORKSPACE}/MEMORY.md`;
      const result = sshExec(exec, host, cmd);
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
      const result = sshExec(exec, host, cmd);
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
      const localConfig = path.join(
        `/home/${SSH_USER}/.openclaw`,
        "openclaw.json"
      );
      // The local config is on the operator's machine at ~/.openclaw/openclaw.json
      // However, this should reference the operator's local file
      const operatorConfig = path.join(
        process.env.HOME ?? "",
        ".openclaw",
        "openclaw.json"
      );
      if (fs.existsSync(operatorConfig)) {
        const result = scpFile(
          exec,
          operatorConfig,
          host,
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
      const result = sshExec(exec, host, "systemctl --user restart openclaw-gateway");
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
    process.exit(1);
  }
};
