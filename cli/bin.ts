#!/usr/bin/env node

/**
 * Agent Army CLI — Entry point
 *
 * Provides interactive commands for the full agent lifecycle:
 * init, deploy, redeploy, status, ssh, validate, destroy, config
 */

import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { setupGracefulShutdown } from "./lib/process";
import { initCommand } from "./commands/init";
import { deployCommand } from "./commands/deploy";
import { statusCommand } from "./commands/status";
import { sshCommand } from "./commands/ssh";
import { validateCommand } from "./commands/validate";
import { pushCommand } from "./commands/push";
import type { PushOptions } from "./tools/push";
import { destroyCommand } from "./commands/destroy";
import { listCommand } from "./commands/list";
import { updateCommand } from "./commands/update";
import { configShowCommand, configSetCommand } from "./commands/config";
import { secretsSetCommand, secretsListCommand } from "./commands/secrets";
import { redeployCommand } from "./commands/redeploy";
import { webhooksSetupCommand } from "./commands/webhooks";
import { checkForUpdates } from "./lib/update-check";

// Forward SIGINT/SIGTERM to child processes before exiting
setupGracefulShutdown();

// Read version from package.json so it stays in sync with npm publish
const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("agent-army")
  .description("Deploy and manage a fleet of OpenClaw AI agents on AWS")
  .version(pkgJson.version);

program
  .command("init")
  .description("Interactive setup wizard — configure stack, secrets, and agents")
  .option("--deploy", "Deploy immediately after init")
  .option("-y, --yes", "Skip confirmation prompt (for deploy)")
  .action(async (opts) => {
    await initCommand(opts);
  });

program
  .command("deploy")
  .description("Deploy agents with pulumi up")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await deployCommand(opts);
  });

program
  .command("status")
  .description("Show agent statuses from stack outputs")
  .option("--json", "Output as JSON")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await statusCommand(opts);
  });

program
  .command("ssh <agent>")
  .description("SSH to an agent by name or alias (juno, titus, scout)")
  .option("-u, --user <user>", "SSH user")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .argument("[command...]", "Command to run on the agent")
  .action(async (agent: string, commandArgs: string[], opts) => {
    await sshCommand(agent, commandArgs, opts);
  });

program
  .command("validate")
  .description("Health check agents via Tailscale SSH")
  .option("-t, --timeout <seconds>", "SSH timeout in seconds", "30")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await validateCommand(opts);
  });

program
  .command("push")
  .description("Push workspace files, skills, and config to running agents")
  .option("--skills", "Sync skills to remote workspace")
  .option("--workspace", "Sync workspace files from identity")
  .option("--memory-reset", "Remove remote memory/ dir and MEMORY.md")
  .option("--openclaw", "Upgrade openclaw to latest + restart gateway")
  .option("--config-push", "Copy local openclaw.json to remote + restart gateway")
  .option("-a, --agent <name>", "Target a single agent (name, role, or alias)")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts: PushOptions & { configPush?: boolean }) => {
    await pushCommand({
      skills: opts.skills,
      workspace: opts.workspace,
      memoryReset: opts.memoryReset,
      openclaw: opts.openclaw,
      pushConfig: opts.configPush,
      agent: opts.agent,
      config: opts.config,
    });
  });

program
  .command("redeploy")
  .description("Update agents in-place without destroying infrastructure")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await redeployCommand(opts);
  });

program
  .command("destroy")
  .description("Tear down all resources with safety confirmations")
  .option("-y, --yes", "Skip confirmation prompts (dangerous!)")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await destroyCommand(opts);
  });

program
  .command("list")
  .description("List all saved configs")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    await listCommand(opts);
  });

const configCmd = program
  .command("config")
  .description("View or modify config without re-running init");

configCmd
  .command("show")
  .description("Display current config")
  .option("--json", "Output as JSON")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await configShowCommand(opts);
  });

configCmd
  .command("set <key> <value>")
  .description("Update a config value")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .option("-a, --agent <name>", "Target a specific agent")
  .action(async (key: string, value: string, opts) => {
    await configSetCommand(key, value, opts);
  });

const secretsCmd = program
  .command("secrets")
  .description("View or update Pulumi secrets without re-running init");

secretsCmd
  .command("set <key> <value>")
  .description("Set a secret (e.g. braveApiKey, anthropicApiKey)")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .option("-a, --agent <role>", "Agent role for per-agent secrets (e.g. eng, pm, tester)")
  .action(async (key: string, value: string, opts) => {
    await secretsSetCommand(key, value, opts);
  });

secretsCmd
  .command("list")
  .description("Show which secrets are configured (values redacted)")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await secretsListCommand(opts);
  });

const webhooksCmd = program
  .command("webhooks")
  .description("Manage agent webhooks");

webhooksCmd
  .command("setup")
  .description("Configure Linear webhooks for deployed agents")
  .option("-c, --config <name>", "Config name (auto-detected if only one)")
  .action(async (opts) => {
    await webhooksSetupCommand(opts);
  });

program
  .command("update")
  .description("Update agent-army CLI to the latest version")
  .action(async (opts) => {
    await updateCommand(opts);
  });

// Fire-and-forget update check — must run before parse() because
// Commander's --help/--version call process.exit() synchronously.
// The cached path (no await) prints the notice before exit;
// the stale-cache path fetches in the background for the next run.
checkForUpdates(pkgJson.version).catch(() => {});

program.parse();
