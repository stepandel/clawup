# Agent Army - Development Guide

## Project Overview

Agent Army deploys fleets of specialized AI agents (PM, Engineer, QA) on AWS or Hetzner Cloud. Each agent runs OpenClaw with Claude Code in a Docker sandbox, connected via Tailscale mesh VPN.

## Architecture

```text
agent-army/
├── cli/                    # Published npm package (agent-army CLI)
│   ├── bin.ts              # Entry point - Commander.js commands
│   ├── commands/           # Command implementations (init, deploy, ssh, etc.)
│   ├── lib/                # Shared utilities (config, pulumi, ui, exec)
│   ├── adapters/           # Runtime adapters (CLI vs API)
│   └── types.ts            # Shared TypeScript types
├── src/                    # Pulumi components (infrastructure as code)
│   └── components/
│       ├── openclaw-agent.ts    # AWS EC2 agent
│       ├── hetzner-agent.ts     # Hetzner Cloud agent
│       ├── cloud-init.ts        # User-data script generation
│       └── config-generator.ts  # OpenClaw config builder
├── web/                    # Next.js dashboard (agent-army-web)
│   └── src/
│       ├── app/            # App router pages & API routes
│       ├── components/     # React components (shadcn/ui)
│       └── lib/            # Server utilities (prisma, auth, crypto)
├── presets/                # Agent role definitions
│   ├── base/               # Shared workspace files (AGENTS.md, BOOTSTRAP.md)
│   ├── pm/                 # Juno - Product Manager
│   ├── eng/                # Titus - Engineer
│   ├── tester/             # Scout - QA
│   └── skills/             # Reusable agent skills
├── index.ts                # Main Pulumi stack program
├── shared-vpc.ts           # AWS VPC component
└── docs/                   # Mintlify documentation
```

## Key Concepts

### Manifest (agent-army.yaml)
The manifest is the source of truth for deployments. Created by `agent-army init`, it defines:
- Stack name, cloud provider, region, instance type
- Owner info (name, timezone, working hours)
- Agent definitions (preset, identity, or custom)
- Per-agent plugin list (e.g., `plugins: [openclaw-linear]`)

Plugin configs are stored separately at `~/.agent-army/configs/<stack>/plugins/<plugin>.yaml`.

### Pulumi Stack
Infrastructure is managed via Pulumi. Secrets (API keys, tokens) are stored encrypted in Pulumi config, not in the manifest.

### Cloud-init
Agents are provisioned via cloud-init scripts that install Docker, Node.js, OpenClaw, Claude Code, and Tailscale.

### Workspace Files
Each agent gets workspace files injected into `~/.openclaw/workspace/`. These define personality (SOUL.md), identity (IDENTITY.md), periodic tasks (HEARTBEAT.md), and tool usage (TOOLS.md).

## Development Commands

```bash
# Root (Pulumi components)
pnpm install           # Install all dependencies
pnpm build             # Build Pulumi components
pnpm watch             # Watch mode

# CLI development
cd cli
pnpm build             # Build CLI
pnpm watch             # Watch mode

# Web development
cd web
pnpm dev               # Start dev server (localhost:3000)
pnpm build             # Production build
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
| `cli/commands/init.ts` | Interactive setup wizard (largest command) |
| `cli/lib/constants.ts` | Presets, regions, instance types, key instructions |
| `cli/lib/config.ts` | Load/save YAML manifests and plugin configs |
| `src/components/cloud-init.ts` | Cloud-init script generation (dynamic plugin support) |
| `src/components/config-generator.ts` | OpenClaw config builder (dynamic plugin entries) |
| `index.ts` | Main Pulumi program that reads agent-army.yaml manifest |
| `web/src/lib/deploy.ts` | Pulumi Automation API runner |

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

### Adding a New Preset Agent
1. Create directory in `presets/<role>/`
2. Add SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
3. Register in `cli/lib/constants.ts` PRESETS object

### Adding a New CLI Command
1. Create `cli/commands/<name>.ts`
2. Export async function `<name>Command(opts)`
3. Register in `cli/bin.ts` with Commander

### Adding a New Cloud Provider
1. Create component in `src/components/<provider>-agent.ts`
2. Add provider config to `cli/lib/constants.ts`
3. Update `index.ts` to handle new provider
4. Update init command for provider-specific prompts

### Adding an API Route
1. Create `web/src/app/api/<path>/route.ts`
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

### "agent-army.yaml not found"
Run `agent-army init` first, or ensure you're in the project root.

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
