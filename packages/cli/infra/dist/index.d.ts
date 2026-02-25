/**
 * Clawup - Data-Driven Multi-Agent Pulumi Stack
 *
 * Reads clawup.yaml manifest to dynamically deploy OpenClaw agents.
 * The manifest is created by `clawup init` and serves as the single
 * source of truth for the agent fleet configuration.
 *
 * All agents share a single VPC for cost optimization.
 * Each agent loads workspace files from identity repos.
 * Secrets are pulled from Pulumi config (set by CLI or ESC).
 * Plugin configs are loaded from ~/.clawup/configs/<stack>/plugins/.
 */
export {};
//# sourceMappingURL=index.d.ts.map