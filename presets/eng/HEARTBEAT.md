# Heartbeat Checklist

## Always

- [ ] If `BOOTSTRAP.md` exists in workspace, follow it first. Do not continue with the rest of this checklist until bootstrap is complete.
- [ ] Load `memory/agent-state.json`. If `consecutiveErrors >= 3`, notify Boss on Slack: "Circuit breaker tripped — pausing autonomous operation." then STOP.
- [ ] If state is `AGENT_RUNNING`, check Claude Code session — if stuck 3+ cycles, comment on Linear ticket and notify human. If completed, transition to `BUILD_CHECK`.
- [ ] If state is `BUILD_CHECK`, run `pnpm typecheck && pnpm build && pnpm test:e2e` in project dir. On pass: create PR, assign Scout as reviewer, move Linear ticket to "In Review by agent" or "In Review" and assign Scout, set IDLE. On fail (< 3 attempts): spawn Claude Code to fix, set AGENT_RUNNING. On fail (3+ attempts): create draft PR with failure summary, set IDLE.
- [ ] If state is `IDLE`, check Linear for next prioritized ticket assigned to me (no `-A` flag, use `--state backlog --state unstarted`). If found: set In Progress, spawn Claude Code with ticket context, set AGENT_RUNNING. If none: HEARTBEAT_OK.
- [ ] Write updated state to `memory/agent-state.json` and log transition to `memory/YYYY-MM-DD.md`.