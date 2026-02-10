/**
 * Destroy Tool — Tear down resources with safety confirmations
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { loadManifest, resolveConfigName } from "../lib/config";
import { tailscaleHostname } from "../lib/constants";
import pc from "picocolors";

export interface DestroyOptions {
  /** Skip confirmation prompts (dangerous!) */
  yes?: boolean;
  /** Config name (auto-detected if only one) */
  config?: string;
}

interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
}

/**
 * Format agent list for display
 */
function formatAgentList(
  agents: { displayName: string; role: string; preset: string | null }[]
): string {
  return agents
    .map((a) => {
      const type = a.preset ? `preset:${a.preset}` : "custom";
      return `  ${pc.bold(a.displayName)} (${a.role}) [${type}]`;
    })
    .join("\n");
}

/**
 * Get Pulumi config value
 */
function getConfig(exec: ExecAdapter, key: string): string | null {
  const result = exec.capture("pulumi", ["config", "get", key]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * List all devices on a tailnet via the Tailscale API.
 */
function listTailscaleDevices(
  exec: ExecAdapter,
  apiKey: string,
  tailnet: string
): TailscaleDevice[] | null {
  const result = exec.capture("curl", [
    "-sf",
    "-H", `Authorization: Bearer ${apiKey}`,
    `https://api.tailscale.com/api/v2/tailnet/${tailnet}/devices?fields=default`,
  ]);
  if (result.exitCode !== 0) return null;
  try {
    const data = JSON.parse(result.stdout);
    if (!data.devices || !Array.isArray(data.devices)) return null;
    return data.devices.map((d: Record<string, unknown>) => ({
      id: d.id as string,
      name: (d.name as string) ?? "",
      hostname: (d.hostname as string) ?? "",
    }));
  } catch (err) {
    console.warn(`[destroy] Failed to parse Tailscale API response: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Delete a single Tailscale device by ID.
 */
function deleteTailscaleDevice(
  exec: ExecAdapter,
  apiKey: string,
  deviceId: string
): boolean {
  const result = exec.capture("curl", [
    "-sf",
    "-X", "DELETE",
    "-H", `Authorization: Bearer ${apiKey}`,
    `https://api.tailscale.com/api/v2/device/${deviceId}`,
  ]);
  return result.exitCode === 0;
}

/**
 * Destroy tool implementation
 */
export const destroyTool: ToolImplementation<DestroyOptions> = async (
  runtime: RuntimeAdapter,
  options: DestroyOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Agent Army");

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

  // Select/create stack
  const selectResult = exec.capture("pulumi", ["stack", "select", manifest.stackName]);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", manifest.stackName]);
    if (initResult.exitCode !== 0) {
      ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
      process.exit(1);
    }
  }

  // Show what will be destroyed
  ui.note(
    [
      `Stack:  ${manifest.stackName}`,
      `Region: ${manifest.region}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      `This will PERMANENTLY DESTROY:`,
      `  - ${manifest.agents.length} EC2 instances`,
      `  - All workspace data on those instances`,
      `  - VPC, subnet, and security group`,
      `  - Tailscale device registrations`,
    ].join("\n"),
    "Destruction Plan"
  );

  // Confirm
  if (!options.yes) {
    const typedName = await ui.text({
      message: `Type the stack name to confirm: "${manifest.stackName}"`,
      validate: (val) => {
        if (val !== manifest.stackName) return `Must type "${manifest.stackName}" to confirm`;
        return undefined;
      },
    });

    const confirmed = await ui.confirm({
      message: "Are you ABSOLUTELY sure?",
      initialValue: false,
    });
    if (!confirmed) {
      ui.cancel("Destruction cancelled.");
    }
  }

  // Destroy infrastructure
  ui.log.step("Running pulumi destroy...");
  console.log();
  const exitCode = await exec.stream("pulumi", ["destroy", "--yes"]);
  console.log();

  if (exitCode !== 0) {
    ui.log.error("Destruction failed. Check the output above for details.");
    process.exit(1);
  }

  // Clean up Tailscale devices after infrastructure is destroyed
  const tailnetDnsName = getConfig(exec, "tailnetDnsName");
  const tailscaleApiKey = getConfig(exec, "tailscaleApiKey");

  if (tailnetDnsName && tailscaleApiKey) {
    const spinner = ui.spinner("Removing agents from Tailscale...");
    const apiFailed: string[] = [];

    const tailnet = tailnetDnsName;
    const devices = listTailscaleDevices(exec, tailscaleApiKey, tailnet);

    if (devices) {
      for (const agent of manifest.agents) {
        const tsHost = tailscaleHostname(manifest.stackName, agent.name);
        const device = devices.find((d) =>
          d.hostname === tsHost || d.name.startsWith(`${tsHost}.`)
        );
        if (device) {
          const deleted = deleteTailscaleDevice(exec, tailscaleApiKey, device.id);
          if (!deleted) apiFailed.push(agent.name);
        }
      }

      if (apiFailed.length === 0) {
        spinner.stop("Tailscale devices cleaned up");
      } else {
        spinner.stop("Some Tailscale devices could not be removed");
        ui.log.warn(
          `Could not remove: ${apiFailed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
        );
      }
    } else {
      spinner.stop("Could not list Tailscale devices");
      ui.log.warn("Manual cleanup may be needed at https://login.tailscale.com/admin/machines");
    }
  } else if (tailnetDnsName && !tailscaleApiKey) {
    ui.log.warn("No Tailscale API key configured - devices must be removed manually.");
    console.log("  Remove devices at: https://login.tailscale.com/admin/machines");
    console.log("  Tip: Set a Tailscale API key (`agent-army init`) for automatic cleanup.");
  }

  ui.log.success(`Stack "${manifest.stackName}" has been destroyed.`);
  ui.outro("Done!");
};
