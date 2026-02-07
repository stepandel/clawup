/**
 * agent-army validate — Health check agents via Tailscale SSH
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { getConfig, selectOrCreateStack } from "../lib/pulumi";
import { capture } from "../lib/exec";
import { SSH_USER } from "../lib/constants";
import { showBanner, exitWithError } from "../lib/ui";
import pc from "picocolors";

interface ValidateOptions {
  timeout?: string;
}

interface CheckResult {
  agent: string;
  checks: { name: string; passed: boolean; detail?: string }[];
  passed: boolean;
}

function runSshCheck(
  host: string,
  command: string,
  timeout: number
): { ok: boolean; output: string } {
  const result = capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    `${SSH_USER}@${host}`,
    command,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

export async function validateCommand(opts: ValidateOptions): Promise<void> {
  showBanner();

  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
  }

  // Select stack
  if (!selectOrCreateStack(manifest.stackName)) {
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Get tailnet
  const tailnetDnsName = getConfig("tailnetDnsName");
  if (!tailnetDnsName) {
    exitWithError("Could not determine tailnet DNS name from Pulumi config.");
  }

  const timeout = parseInt(opts.timeout ?? "30", 10);
  const results: CheckResult[] = [];

  p.log.step(`Validating ${manifest.agents.length} agents (timeout: ${timeout}s)...`);
  console.log();

  for (const agent of manifest.agents) {
    const host = `${agent.name}.${tailnetDnsName}`;
    const checks: CheckResult["checks"] = [];

    p.log.info(`${pc.bold(agent.displayName)} (${agent.role}) — ${host}`);

    // Check 1: SSH connectivity
    const ssh = runSshCheck(host, "echo 'SSH OK'", timeout);
    checks.push({
      name: "SSH connectivity",
      passed: ssh.ok,
      detail: ssh.ok ? "connected" : "connection failed",
    });

    if (ssh.ok) {
      // Check 2: OpenClaw gateway running
      const gateway = runSshCheck(host, "openclaw gateway status 2>&1", timeout);
      const isRunning = gateway.ok && /running/i.test(gateway.output);
      checks.push({
        name: "OpenClaw gateway",
        passed: isRunning,
        detail: isRunning ? "running" : "not running",
      });

      // Check 3: Workspace files present
      const workspace = runSshCheck(
        host,
        `test -f /home/${SSH_USER}/.openclaw/workspace/SOUL.md && test -f /home/${SSH_USER}/.openclaw/workspace/HEARTBEAT.md && echo 'OK'`,
        timeout
      );
      checks.push({
        name: "Workspace files",
        passed: workspace.ok,
        detail: workspace.ok ? "SOUL.md + HEARTBEAT.md present" : "missing files",
      });
    } else {
      checks.push({ name: "OpenClaw gateway", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "Workspace files", passed: false, detail: "skipped (no SSH)" });
    }

    // Display check results
    const allPassed = checks.every((c) => c.passed);
    for (const check of checks) {
      const icon = check.passed ? pc.green("PASS") : pc.red("FAIL");
      console.log(`    ${icon}  ${check.name}: ${check.detail ?? ""}`);
    }
    console.log();

    results.push({ agent: agent.displayName, checks, passed: allPassed });
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const summaryLines = [
    `Total:  ${results.length}`,
    `Passed: ${passed}`,
    `Failed: ${failed}`,
  ];

  p.note(summaryLines.join("\n"), "Validation Summary");

  if (failed > 0) {
    p.log.warn("Some agents failed validation.");
    p.log.message("  1. Wait 3-5 minutes for cloud-init to complete");
    p.log.message("  2. Check logs: agent-army ssh <agent> 'journalctl -u openclaw'");
    p.log.message("  3. Verify Tailscale: tailscale status");
    process.exit(1);
  } else {
    p.log.success("All agents are healthy!");
  }
}
