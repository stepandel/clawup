# Clawup - Development Guide

## Project Overview

Clawup deploys fleets of specialized AI agents (PM, Engineer, QA) on AWS or Hetzner Cloud. Each agent runs OpenClaw with Claude Code in a Docker sandbox, connected via Tailscale mesh VPN.

## Architecture

```text
clawup/
├── packages/
│   ├── core/                    # @clawup/core — shared types, constants, registries
│   │   └── src/
│   │       ├── schemas/         # Zod schemas (source of truth for types)
│   │       ├── types.ts         # TypeScript types (z.infer<> re-exports)
│   │       ├── constants.ts     # Regions, costs, identities, model providers
│   │       ├── identity.ts      # Git-based identity loader
│   │       ├── skills.ts        # Skill classification (private vs clawhub)
│   │       ├── deps.ts          # Dep resolution
│   │       ├── plugin-registry.ts
│   │       ├── coding-agent-registry.ts
│   │       └── dep-registry.ts
│   ├── cli/                     # Published npm package (clawup CLI)
│   │   ├── bin.ts               # Entry point - Commander.js commands
│   │   ├── commands/            # Command implementations (init, deploy, ssh, etc.)
│   │   ├── tools/               # Tool implementations (adapter-based)
│   │   ├── lib/                 # CLI-only utilities (config, pulumi, ui, exec, tailscale)
│   │   └── adapters/            # Runtime adapters (CLI vs API)
│   ├── pulumi/                  # @clawup/pulumi — infrastructure as code
│   │   └── src/
│   │       ├── components/
│   │       │   ├── openclaw-agent.ts    # AWS EC2 agent
│   │       │   ├── hetzner-agent.ts     # Hetzner Cloud agent
│   │       │   ├── cloud-init.ts        # User-data script generation
│   │       │   └── config-generator.ts  # OpenClaw config builder
│   │       ├── shared-vpc.ts            # AWS VPC component
│   │       └── index.ts                 # Main Pulumi stack program
│   └── web/                     # Next.js dashboard (clawup-web)
│       └── src/
│           ├── app/             # App router pages & API routes
│           ├── components/      # React components (shadcn/ui)
│           └── lib/             # Server utilities (prisma, auth, crypto)
├── identities/                  # Built-in agent identities (self-contained)
├── docs/                        # Mintlify documentation
├── Pulumi.yaml                  # Points to packages/pulumi/dist/index.js
└── pnpm-workspace.yaml          # packages: ["packages/*"]
```

## Key Concepts

### Manifest (clawup.yaml)
The manifest is the source of truth for deployments. Created by `clawup init`, it defines:
- Stack name, cloud provider, region, instance type
- Owner info (name, timezone, working hours)
- Agent definitions (identity-based or custom)
- Per-agent plugin config (inline in the manifest under `agent.plugins`)

Secrets (API keys, tokens) are stored encrypted in Pulumi config, not in the manifest.

### Pulumi Stack
Infrastructure is managed via Pulumi. Secrets (API keys, tokens) are stored encrypted in Pulumi config, not in the manifest.

### Cloud-init
Agents are provisioned via cloud-init scripts that install Docker, Node.js, OpenClaw, Claude Code, and Tailscale.

### Workspace Files
Each agent gets workspace files injected into `~/.openclaw/workspace/`. These define personality (SOUL.md), identity (IDENTITY.md), periodic tasks (HEARTBEAT.md), and tool usage (TOOLS.md).

## Development Commands

```bash
pnpm install                              # Install all dependencies
pnpm build                                # Build all packages
pnpm test                                 # Run all tests

# Individual packages
pnpm --filter @clawup/core build      # Build core
pnpm --filter clawup build            # Build CLI
pnpm --filter @clawup/pulumi build    # Build Pulumi
pnpm --filter clawup-web dev          # Web dev server (localhost:3000)

# Watch mode
cd packages/cli && pnpm watch
```

## Code Conventions

### TypeScript
- Strict mode enabled
- Use explicit types, avoid `any`
- Prefer interfaces over type aliases for object shapes
- Use `Record<string, T>` for dictionaries

### File Organization
- One component/function per file when possible
- Keep files under 300 lines; split large files
- Group related functionality in directories

### Naming
- Files: kebab-case (`cloud-init.ts`)
- Classes/Interfaces: PascalCase (`OpenClawAgent`)
- Functions/variables: camelCase (`generateCloudInit`)
- Constants: SCREAMING_SNAKE_CASE (`AWS_REGIONS`)

### Error Handling
- Use early returns for validation
- Throw descriptive errors with context
- In CLI: use `exitWithError()` for user-facing errors
- In API routes: return appropriate HTTP status codes

### Pulumi Patterns
- Use `pulumi.Output` for async values
- Mark sensitive outputs with `pulumi.secret()`
- Use component resources for reusable infrastructure

## Important Files

| File | Purpose |
|------|---------|
| `packages/cli/commands/init.ts` | Interactive setup wizard (largest command) |
| `packages/cli/lib/config.ts` | Load/save YAML manifests |
| `packages/core/src/constants.ts` | Built-in identities, regions, instance types, key instructions |
| `packages/core/src/schemas/` | Zod schemas (source of truth for all types) |
| `packages/core/src/identity.ts` | Git-based identity loader |
| `packages/pulumi/src/components/cloud-init.ts` | Cloud-init script generation (dynamic plugin support) |
| `packages/pulumi/src/components/config-generator.ts` | OpenClaw config builder (dynamic plugin entries) |
| `packages/pulumi/src/index.ts` | Main Pulumi program that reads clawup.yaml manifest |
| `packages/web/src/lib/deploy.ts` | Pulumi Automation API runner |

## Testing

Run tests with:
```bash
pnpm test
```

Currently minimal test coverage. When adding tests:
- Place tests in `__tests__/` directories or as `*.test.ts` files
- Mock external dependencies (Pulumi, cloud APIs)
- Test CLI commands with mocked adapters

## Common Tasks

### Adding a New Built-in Agent Identity
1. Create an identity directory with `identity.yaml` and workspace files
2. Host in a Git repo (or add to an existing identities repo)
3. Register in `packages/core/src/constants.ts` under `BUILT_IN_IDENTITIES`

### Adding a New CLI Command
1. Create `packages/cli/commands/<name>.ts`
2. Export async function `<name>Command(opts)`
3. Register in `packages/cli/bin.ts` with Commander

### Adding a New Cloud Provider
1. Create component in `packages/pulumi/src/components/<provider>-agent.ts`
2. Add provider config to `packages/core/src/constants.ts`
3. Update `packages/pulumi/src/index.ts` to handle new provider
4. Update init command for provider-specific prompts

### Adding an API Route
1. Create `packages/web/src/app/api/<path>/route.ts`
2. Use `getToken()` for authentication
3. Validate input with Zod schemas
4. Return `NextResponse.json()`

## Security Notes

- Never log secrets or tokens
- Use Pulumi secrets for sensitive config
- Cloud-init scripts use environment variable interpolation
- All agent ports bind to localhost; access via Tailscale only
- Web app uses encrypted credential storage (AES-256-GCM)

## Troubleshooting

### "clawup.yaml not found"
Run `clawup init` first, or ensure you're in the project root.

### Pulumi stack conflicts
```bash
pulumi cancel    # Release lock
pulumi refresh   # Sync state with cloud
```

### Cloud-init failures
SSH into agent and check:
```bash
sudo cat /var/log/cloud-init-output.log | tail -100
```

## Related Documentation

- [README.md](./README.md) - User-facing documentation
- [docs/](./docs/) - Mintlify documentation site
- [OpenClaw Docs](https://docs.openclaw.ai/)
- [Pulumi Docs](https://www.pulumi.com/docs/)
