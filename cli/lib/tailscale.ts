/**
 * Tailscale local daemon detection + API helpers for device management.
 *
 * Detection functions (isTailscaleInstalled, isTailscaleRunning, requireTailscale)
 * check the local Tailscale daemon status for CLI commands that need it.
 *
 * API helpers (listTailscaleDevices, deleteTailscaleDevice) call the Tailscale
 * control-plane API. All API calls retry up to 3 times with exponential backoff
 * and log warnings on failure instead of silently returning null.
 */

import { execSync } from "child_process";
import { spawnSync } from "child_process";
import pc from "picocolors";

/**
 * Check if the Tailscale CLI is installed.
 * Checks system PATH first, then the macOS App Store location.
 */
export function isTailscaleInstalled(): boolean {
  const bin = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(bin, ["tailscale"], { shell: false, stdio: "ignore" });
  if (result.status === 0) return true;

  // macOS App Store installs Tailscale here
  if (process.platform === "darwin") {
    try {
      const fs = require("fs");
      return fs.existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Check if the Tailscale daemon is running and connected.
 * Returns true if BackendState is "Running".
 */
export function isTailscaleRunning(): boolean {
  try {
    const output = execSync("tailscale status --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const status = JSON.parse(output);
    return status.BackendState === "Running";
  } catch {
    return false;
  }
}

/**
 * Require Tailscale to be installed and running.
 * Exits with a clear error message if not.
 */
export function requireTailscale(): void {
  if (!isTailscaleInstalled()) {
    const installHint =
      process.platform === "darwin"
        ? "Install from the Mac App Store or https://tailscale.com/download"
        : "Install from https://tailscale.com/download";

    console.error(
      `\n${pc.red(pc.bold("Error:"))} Tailscale is not installed.\n\n` +
        `This command connects to agents over Tailscale.\n` +
        `  ${installHint}\n`
    );
    process.exit(1);
  }

  if (!isTailscaleRunning()) {
    console.error(
      `\n${pc.red(pc.bold("Error:"))} Tailscale is not connected.\n\n` +
        `This command connects to agents over Tailscale.\n` +
        `  Tailscale is not running. Open the Tailscale app or run: ${pc.cyan("tailscale up")}\n`
    );
    process.exit(1);
  }
}

interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Synchronous sleep using Atomics.wait (safe for CLI context).
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * List all devices on a tailnet via the Tailscale API.
 * Retries up to 3 times with exponential backoff.
 * Returns null on failure.
 */
export function listTailscaleDevices(
  apiKey: string,
  tailnet: string
): TailscaleDevice[] | null {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = execSync(
        `curl -sf -H "Authorization: Bearer ${apiKey}" "https://api.tailscale.com/api/v2/tailnet/${tailnet}/devices?fields=default"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
      );
      const data = JSON.parse(result);
      if (!data.devices || !Array.isArray(data.devices)) return null;
      return data.devices.map((d: Record<string, unknown>) => ({
        id: d.id as string,
        name: (d.name as string) ?? "",
        hostname: (d.hostname as string) ?? "",
      }));
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        sleepSync(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  console.warn(
    `[tailscale] Failed to list devices after ${MAX_RETRIES + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
  return null;
}

/**
 * Remove stale Tailscale devices for a set of agents.
 * Used before deploy/redeploy to prevent duplicate device entries
 * when Pulumi replaces servers (create-before-delete).
 *
 * Returns counts of cleaned, failed, and not-found devices.
 */
export function cleanupTailscaleDevices(
  apiKey: string,
  tailnet: string,
  stackName: string,
  agents: { name: string }[],
): { cleaned: string[]; failed: string[] } {
  const cleaned: string[] = [];
  const failed: string[] = [];

  const devices = listTailscaleDevices(apiKey, tailnet);
  if (!devices) return { cleaned, failed };

  for (const agent of agents) {
    const tsHost = `${stackName}-${agent.name}`;
    const matching = devices.filter((d) =>
      d.hostname === tsHost || d.name.startsWith(`${tsHost}.`)
    );
    for (const device of matching) {
      const deleted = deleteTailscaleDevice(apiKey, device.id);
      if (deleted) {
        cleaned.push(`${agent.name} (${device.hostname})`);
      } else {
        failed.push(agent.name);
      }
    }
  }

  return { cleaned, failed };
}

/**
 * Delete a single Tailscale device by ID.
 * Retries up to 3 times with exponential backoff.
 * Returns true on success.
 */
export function deleteTailscaleDevice(
  apiKey: string,
  deviceId: string
): boolean {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      execSync(
        `curl -sf -X DELETE -H "Authorization: Bearer ${apiKey}" "https://api.tailscale.com/api/v2/device/${deviceId}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
      );
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        sleepSync(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  console.warn(
    `[tailscale] Failed to delete device ${deviceId} after ${MAX_RETRIES + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
  return false;
}

/**
 * Ensure Tailscale Funnel prerequisites are configured for the tailnet.
 * 1. Enables MagicDNS (required for HTTPS certs)
 * 2. Adds funnel capability to ACL nodeAttrs for all members
 *
 * Returns { magicDns: boolean; funnelAcl: boolean } indicating what was changed.
 * Warns on failure instead of throwing.
 */
export function ensureTailscaleFunnel(
  apiKey: string,
): { magicDns: boolean; funnelAcl: boolean } {
  const result = { magicDns: false, funnelAcl: false };

  // 1. Ensure MagicDNS is enabled
  try {
    const dnsResp = tsApiGet(apiKey, "/tailnet/-/dns/preferences");
    const dns = JSON.parse(dnsResp);
    if (!dns.magicDNSEnabled) {
      tsApiPost(apiKey, "/tailnet/-/dns/preferences", { magicDNSEnabled: true });
      result.magicDns = true;
    }
  } catch (err) {
    console.warn(
      `[tailscale] Could not check/enable MagicDNS: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2. Ensure Funnel is allowed in ACL
  try {
    const aclResp = tsApiGet(apiKey, "/tailnet/-/acl");
    const acl = JSON.parse(aclResp);

    const nodeAttrs: Array<{ target?: string[]; attr?: string[] }> = acl.nodeAttrs ?? [];
    const hasFunnel = nodeAttrs.some(
      (a) => Array.isArray(a.attr) && a.attr.includes("funnel")
    );

    if (!hasFunnel) {
      nodeAttrs.push({ target: ["autogroup:member"], attr: ["funnel"] });
      acl.nodeAttrs = nodeAttrs;
      tsApiPost(apiKey, "/tailnet/-/acl", acl);
      result.funnelAcl = true;
    }
  } catch (err) {
    console.warn(
      `[tailscale] Could not check/enable Funnel ACL: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

/** GET a Tailscale API endpoint. Returns response body as string. */
function tsApiGet(apiKey: string, path: string): string {
  return execSync(
    `curl -sf -H "Authorization: Bearer ${apiKey}" -H "Accept: application/json" "https://api.tailscale.com/api/v2${path}"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
  );
}

/** POST JSON to a Tailscale API endpoint. Uses a temp file for the payload. */
function tsApiPost(apiKey: string, path: string, body: unknown): string {
  const fs = require("fs");
  const os = require("os");
  const nodePath = require("path");
  const tmpFile = nodePath.join(os.tmpdir(), `ts-api-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(body));
    return execSync(
      `curl -sf -X POST -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d @${tmpFile} "https://api.tailscale.com/api/v2${path}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
    );
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
