# TOOLS.md - Engineering Tool Notes

## Communication

**Priority:** Slack > other channels. Always respond to Boss on Slack when possible.

## Claude Code

Your primary coding agent. Spawn for complex tasks.

**Use the `coding-agent` skill** — it has all the patterns for PTY, background mode, process monitoring, and auto-notify. Read it before spawning Claude Code.

Quick reference:
- **Always `pty:true`** — hangs without it
- **`background:true` + `workdir`** for longer tasks
- **Monitor:** `process action:log sessionId:XXX`
- **One-shot:** `claude -p "your prompt"` (still needs PTY)
- **Never run in OpenClaw's directory**

## Linear

Ticket tracking.

- CLI: `/home/ubuntu/.deno/bin/linear`
- Requires: `PATH="/home/ubuntu/.deno/bin:$PATH"` prefix and `LINEAR_API_KEY` environment variable
- Teams: (configure your team keys)

### Common Commands

```bash
# List your assigned tickets
linear issue list --filter "assignee:me state:todo,in-progress"

# Start working on ticket
linear issue update <ID> --state "In Progress"

# Mark done
linear issue update <ID> --state "Done"
```

## GitHub

Primary code hosting.

```bash
# Create PR
gh pr create --title "feat: description" --body "Closes #123"

# Check CI status
gh pr checks <PR-NUMBER>

# Request review
gh pr edit <PR-NUMBER> --add-reviewer <username>
```

## Build & Test

Standard commands (adjust per project):

```bash
pnpm install        # Install deps
pnpm typecheck      # Type checking
pnpm build          # Build
pnpm test           # Run tests
pnpm test:e2e       # E2E tests
```

## Git Workflow

1. Create feature branch: `git checkout -b feature/ticket-id-description`
2. Make changes, commit with conventional commits
3. Push and create PR
4. Request review from Boss
5. Merge after approval

---

_Add project-specific notes below_
