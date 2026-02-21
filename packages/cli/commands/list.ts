/**
 * List all saved configs in a table
 */

import { listManifests, loadManifest, configPath } from "../lib/config";

interface ListOptions {
  json?: boolean;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  const configs = listManifests();

  if (configs.length === 0) {
    console.log("No configs found. Run 'agent-army init' to create one.");
    return;
  }

  const data = configs.map((name) => {
    const manifest = loadManifest(name);
    return {
      name,
      agents: manifest?.agents.length ?? 0,
      region: manifest?.region ?? "-",
      stack: manifest?.stackName ?? "-",
      path: configPath(name),
    };
  });

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Calculate column widths
  const nameWidth = Math.max(6, ...data.map((d) => d.name.length));
  const agentsWidth = 6;
  const regionWidth = Math.max(6, ...data.map((d) => d.region.length));
  const stackWidth = Math.max(5, ...data.map((d) => d.stack.length));

  // Print header
  console.log(
    `${"NAME".padEnd(nameWidth)}  ${"AGENTS".padEnd(agentsWidth)}  ${"REGION".padEnd(regionWidth)}  ${"STACK".padEnd(stackWidth)}`
  );
  console.log(
    `${"-".repeat(nameWidth)}  ${"-".repeat(agentsWidth)}  ${"-".repeat(regionWidth)}  ${"-".repeat(stackWidth)}`
  );

  // Print rows
  for (const row of data) {
    console.log(
      `${row.name.padEnd(nameWidth)}  ${String(row.agents).padEnd(agentsWidth)}  ${row.region.padEnd(regionWidth)}  ${row.stack.padEnd(stackWidth)}`
    );
  }

  console.log(`\n${data.length} config(s) found`);
}
