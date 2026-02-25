"use strict";
/**
 * LocalDockerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent in a local Docker container (for testing)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDockerOpenClawAgent = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const docker = __importStar(require("@pulumi/docker"));
const shared_1 = require("./shared");
/**
 * LocalDockerOpenClaw Agent ComponentResource
 *
 * Provisions an OpenClaw agent in a local Docker container:
 * - Uses same cloud-init script as cloud providers
 * - Skips Docker-in-Docker and Tailscale
 * - Maps gateway port to host for direct access
 * - Runs daemon in foreground to keep container alive
 *
 * @example
 * ```typescript
 * const agent = new LocalDockerOpenClawAgent("my-agent", {
 *   anthropicApiKey: config.requireSecret("anthropicApiKey"),
 *   tailscaleAuthKey: pulumi.secret("not-used"),
 *   tailnetDnsName: "localhost",
 *   gatewayPort: 18789,
 * });
 *
 * export const url = agent.gatewayUrl;
 * ```
 */
class LocalDockerOpenClawAgent extends pulumi.ComponentResource {
    /** Always "127.0.0.1" for local Docker */
    publicIp;
    /** Gateway URL (http://localhost:<port>/?token=...) */
    tailscaleUrl;
    /** Gateway authentication token */
    gatewayToken;
    /** SSH private key (Ed25519) — not used for local but kept for interface compat */
    sshPrivateKey;
    /** SSH public key */
    sshPublicKey;
    /** Docker container ID */
    containerId;
    /** Docker container name */
    containerName;
    constructor(name, args, opts) {
        super("clawup:local:LocalDockerOpenClawAgent", name, {}, opts);
        const defaultResourceOptions = { parent: this };
        const image = args.image ?? "ubuntu:24.04";
        const baseLabels = args.labels ?? {};
        // Generate SSH key pair + gateway token (reuse shared helper)
        const { sshKey, gatewayTokenValue } = (0, shared_1.generateKeyPairAndToken)(name, defaultResourceOptions);
        // Build cloud-init user data (no compression, no Docker, no Tailscale, foreground mode)
        const userData = (0, shared_1.buildCloudInitUserData)(name, args, gatewayTokenValue, {
            skipDocker: true,
            skipTailscale: true,
            foregroundMode: true,
            createUbuntuUser: true,
            compress: false,
            enableSandbox: false,
        });
        // Pull the base image
        const remoteImage = new docker.RemoteImage(`${name}-image`, { name: image }, defaultResourceOptions);
        // Resolve the gateway port
        const hostPort = pulumi.output(args.gatewayPort);
        const containerGatewayPort = 18789;
        // Create the container
        // The cloud-init script is passed as a base64-encoded env var and decoded+executed as the entrypoint
        const container = new docker.Container(`${name}-container`, {
            name: `clawup-${pulumi.getStack()}-${name}`,
            image: remoteImage.imageId,
            // Decode the cloud-init script from env var and execute it
            entrypoints: ["/bin/bash", "-c"],
            command: ["echo $CLOUDINIT_SCRIPT | base64 -d | bash"],
            envs: [
                userData.apply((script) => {
                    const encoded = Buffer.from(script).toString("base64");
                    return `CLOUDINIT_SCRIPT=${encoded}`;
                }),
            ],
            ports: [
                {
                    internal: containerGatewayPort,
                    external: hostPort,
                },
            ],
            labels: Object.entries({
                ...baseLabels,
                "clawup.project": "clawup",
                "clawup.stack": pulumi.getStack(),
                "clawup.agent": name,
            }).map(([label, value]) => ({ label, value })),
            mustRun: true,
        }, defaultResourceOptions);
        // Set outputs
        this.publicIp = pulumi.output("127.0.0.1");
        this.containerId = container.id;
        this.containerName = container.name;
        this.sshPrivateKey = pulumi.secret(sshKey.privateKeyOpenssh);
        this.sshPublicKey = sshKey.publicKeyOpenssh;
        this.gatewayToken = pulumi.secret(gatewayTokenValue);
        // Gateway URL on localhost (no Tailscale)
        this.tailscaleUrl = pulumi.secret(pulumi.interpolate `http://localhost:${hostPort}/?token=${gatewayTokenValue}`);
        // Register outputs
        this.registerOutputs({
            publicIp: this.publicIp,
            tailscaleUrl: this.tailscaleUrl,
            gatewayToken: this.gatewayToken,
            sshPrivateKey: this.sshPrivateKey,
            sshPublicKey: this.sshPublicKey,
            containerId: this.containerId,
            containerName: this.containerName,
        });
    }
}
exports.LocalDockerOpenClawAgent = LocalDockerOpenClawAgent;
//# sourceMappingURL=local-docker-agent.js.map