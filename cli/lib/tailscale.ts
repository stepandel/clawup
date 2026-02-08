/**
 * Tailscale API helpers for device management
 */

import { execSync } from "child_process";

interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
}

/**
 * List all devices on a tailnet via the Tailscale API.
 * Returns null on failure.
 */
export function listTailscaleDevices(
  apiKey: string,
  tailnet: string
): TailscaleDevice[] | null {
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
  } catch {
    return null;
  }
}

/**
 * Delete a single Tailscale device by ID.
 * Returns true on success.
 */
export function deleteTailscaleDevice(
  apiKey: string,
  deviceId: string
): boolean {
  try {
    execSync(
      `curl -sf -X DELETE -H "Authorization: Bearer ${apiKey}" "https://api.tailscale.com/api/v2/device/${deviceId}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
    );
    return true;
  } catch {
    return false;
  }
}
