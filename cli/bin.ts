#!/usr/bin/env node

/**
 * Agent Army CLI — Entry point
 *
 * Provides interactive commands for the full agent lifecycle:
 * init, deploy, status, ssh, validate, destroy
 */

import { Command } from "commander";
import { initCommand } from "./commands/init";
import { deployCommand } from "./commands/deploy";
import { statusCommand } from "./commands/status";
import { sshCommand } from "./commands/ssh";
import { validateCommand } from "./commands/validate";
import { destroyCommand } from "./commands/destroy";

const program = new Command();

program
  .name("agent-army")
  .description("Deploy and manage a fleet of OpenClaw AI agents on AWS")
  .version("0.1.0");

program
  .command("init")
  .description("Interactive setup wizard — configure stack, secrets, and agents")
  .action(async () => {
    await initCommand();
  });

program
  .command("deploy")
  .description("Deploy agents with pulumi up")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    await deployCommand(opts);
  });

program
  .command("status")
  .description("Show agent statuses from stack outputs")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    await statusCommand(opts);
  });

program
  .command("ssh <agent>")
  .description("SSH to an agent by name or alias (sage, atlas, scout)")
  .option("-u, --user <user>", "SSH user")
  .argument("[command...]", "Command to run on the agent")
  .action(async (agent: string, commandArgs: string[], opts) => {
    await sshCommand(agent, commandArgs, opts);
  });

program
  .command("validate")
  .description("Health check agents via Tailscale SSH")
  .option("-t, --timeout <seconds>", "SSH timeout in seconds", "30")
  .action(async (opts) => {
    await validateCommand(opts);
  });

program
  .command("destroy")
  .description("Tear down all resources with safety confirmations")
  .option("-y, --yes", "Skip confirmation prompts (dangerous!)")
  .action(async (opts) => {
    await destroyCommand(opts);
  });

program.parse();
