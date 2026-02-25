/**
 * Pulumi Automation API deployment runner.
 * Runs deployments asynchronously and updates status in the database.
 */

import { createHash } from "crypto";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import YAML from "yaml";

const FINGERPRINT_KEY = "clawup:projectFingerprint";

/**
 * Run a Pulumi deployment asynchronously.
 * Updates deployment status in DB as it progresses.
 */
export async function runDeployment(deploymentId: string): Promise<void> {
  let logs = "";

  const appendLog = (msg: string) => {
    logs += `[${new Date().toISOString()}] ${msg}\n`;
  };

  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { credential: true },
    });

    if (!deployment) throw new Error("Deployment not found");
    if (!deployment.credential) throw new Error("Credential not found");

    // Update status to running
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: "running", logs: "" },
    });

    appendLog("Starting deployment...");

    // Decrypt credentials
    const decryptedCreds = decrypt({
      encryptedData: deployment.credential.encryptedData,
      iv: deployment.credential.iv,
      authTag: deployment.credential.authTag,
    });

    appendLog(`Provider: ${deployment.credential.provider}`);
    appendLog(`Stack: ${deployment.stackName}`);

    // Parse manifest (supports both YAML and JSON)
    const manifest = YAML.parse(deployment.manifest);
    appendLog(`Agents: ${manifest.agents?.map((a: { displayName: string }) => a.displayName).join(", ")}`);

    // Import Pulumi Automation API
    // @ts-expect-error — pulumi is only available at runtime on deploy servers
    const { LocalWorkspace } = await import("@pulumi/pulumi/automation");

    // Parse credentials for environment
    let envVars: Record<string, string> = {};
    try {
      const creds = JSON.parse(decryptedCreds);
      envVars = creds;
    } catch {
      // Single value credential
      envVars = { API_KEY: decryptedCreds };
    }

    appendLog("Initializing Pulumi workspace...");

    // Create or select stack using Automation API
    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: `${deployment.userId}-${deployment.stackName}`,
      workDir: process.cwd(),
    });

    // Verify/stamp project fingerprint to detect stack collisions
    const fingerprintSource = `${deployment.userId}:${deployment.stackName}`;
    const expectedFingerprint = createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 16);
    try {
      const stored = await stack.getConfig(FINGERPRINT_KEY);
      if (stored && stored.value !== expectedFingerprint) {
        throw new Error(
          "Stack name collision detected! This Pulumi stack belongs to a different deployment."
        );
      }
    } catch (err) {
      // getConfig throws if the key doesn't exist — that's fine (legacy stack)
      if (err instanceof Error && err.message.includes("collision")) throw err;
    }
    await stack.setConfig(FINGERPRINT_KEY, { value: expectedFingerprint });

    // Set config from manifest
    await stack.setConfig("stackName", { value: manifest.stackName });
    await stack.setConfig("provider", { value: manifest.provider });
    await stack.setConfig("region", { value: manifest.region });
    await stack.setConfig("instanceType", { value: manifest.instanceType });

    // Set credentials as secrets
    for (const [key, value] of Object.entries(envVars)) {
      await stack.setConfig(key, { value: value as string, secret: true });
    }

    appendLog("Running pulumi up...");

    // Run deployment
    const upResult = await stack.up({
      onOutput: (msg: string) => {
        appendLog(msg.trim());
      },
    });

    appendLog(`Deployment complete. ${upResult.summary.resourceChanges?.create ?? 0} resources created.`);

    // Update status to success
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "success",
        logs,
        pulumiStack: `${deployment.userId}-${deployment.stackName}`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    appendLog(`ERROR: ${errorMessage}`);

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "failed",
        logs,
        errorMessage,
      },
    });
  }
}
