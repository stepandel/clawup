"use strict";
/**
 * Shared helpers for OpenClaw agent components (AWS + Hetzner)
 *
 * Extracts the duplicated SSH key generation, gateway token derivation,
 * and cloud-init user data assembly that was identical across providers.
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
exports.generateKeyPairAndToken = generateKeyPairAndToken;
exports.buildCloudInitUserData = buildCloudInitUserData;
const pulumi = __importStar(require("@pulumi/pulumi"));
const tls = __importStar(require("@pulumi/tls"));
const crypto = __importStar(require("crypto"));
const cloud_init_1 = require("./cloud-init");
/**
 * Generate an SSH key pair and a gateway authentication token.
 * Both providers use the same ED25519 key generation pattern.
 */
function generateKeyPairAndToken(name, resourceOptions) {
    const sshKey = new tls.PrivateKey(`${name}-ssh-key`, { algorithm: "ED25519" }, resourceOptions);
    const tokenKey = new tls.PrivateKey(`${name}-gateway-token-key`, { algorithm: "ED25519" }, resourceOptions);
    const gatewayTokenValue = tokenKey.publicKeyOpenssh.apply((key) => {
        const hash = crypto.createHash("sha256").update(key).digest("hex");
        return hash.substring(0, 48);
    });
    return { sshKey, gatewayTokenValue };
}
/**
 * Build the cloud-init user data script from base agent args.
 *
 * Resolves all Pulumi secrets/outputs, assembles a CloudInitConfig,
 * generates + interpolates the script, and optionally compresses it.
 */
function buildCloudInitUserData(name, args, gatewayTokenValue, defaults) {
    const pluginSecretEntries = Object.entries(args.pluginSecrets ?? {});
    const pluginSecretOutputs = pluginSecretEntries.map(([, v]) => pulumi.output(v));
    const depSecretEntries = Object.entries(args.depSecrets ?? {});
    const depSecretOutputs = depSecretEntries.map(([, v]) => pulumi.output(v));
    // Stage 1: resolve all string secrets (same type, safe in one pulumi.all)
    return pulumi
        .all([
        args.tailscaleAuthKey,
        args.anthropicApiKey,
        gatewayTokenValue,
        ...pluginSecretOutputs,
        ...depSecretOutputs,
    ])
        .apply(([tsAuthKey, apiKey, gwToken, ...secretValues]) => {
        // Stage 2: resolve mixed-type Input<> config values
        return pulumi
            .all([
            pulumi.output(defaults?.gatewayPort ?? args.gatewayPort ?? 18789),
            pulumi.output(defaults?.browserPort ?? args.browserPort ?? 18791),
            pulumi.output(defaults?.model ?? args.model ?? "anthropic/claude-opus-4-6"),
            pulumi.output(defaults?.enableSandbox ?? args.enableSandbox ?? true),
        ])
            .apply(([gatewayPort, browserPort, model, enableSandbox]) => {
            const tsHostname = `${pulumi.getStack()}-${name}`;
            // Build additional secrets map from plugin secrets + dep secrets
            const additionalSecrets = {};
            pluginSecretEntries.forEach(([envVar], idx) => {
                additionalSecrets[envVar] = secretValues[idx];
            });
            depSecretEntries.forEach(([envVar], idx) => {
                additionalSecrets[envVar] = secretValues[pluginSecretEntries.length + idx];
            });
            const cloudInitConfig = {
                anthropicApiKey: apiKey,
                tailscaleAuthKey: tsAuthKey,
                gatewayToken: gwToken,
                gatewayPort: gatewayPort,
                browserPort: browserPort,
                model: model,
                backupModel: args.backupModel,
                codingAgent: args.codingAgent,
                enableSandbox: enableSandbox,
                tailscaleHostname: tsHostname,
                workspaceFiles: args.workspaceFiles,
                envVars: args.envVars,
                postSetupCommands: args.postSetupCommands,
                createUbuntuUser: defaults?.createUbuntuUser,
                skipTailscale: defaults?.skipTailscale,
                skipDocker: defaults?.skipDocker,
                foregroundMode: defaults?.foregroundMode,
                plugins: args.plugins,
                enableFunnel: args.enableFunnel,
                clawhubSkills: args.clawhubSkills,
                deps: args.deps,
                depSecrets: additionalSecrets,
            };
            const script = (0, cloud_init_1.generateCloudInit)(cloudInitConfig);
            const interpolated = (0, cloud_init_1.interpolateCloudInit)(script, {
                anthropicApiKey: apiKey,
                tailscaleAuthKey: tsAuthKey,
                gatewayToken: gwToken,
                additionalSecrets,
            });
            return defaults?.compress ? (0, cloud_init_1.compressCloudInit)(interpolated) : interpolated;
        });
    });
}
//# sourceMappingURL=shared.js.map