# Heartbeat Checklist

## Always

- [ ] If `BOOTSTRAP.md` exists in workspace, follow it first. Do not continue with the rest of this checklist until bootstrap is complete.
- [ ] Load `memory/agent-state.json`. If `consecutiveErrors >= 3`, notify Boss on Slack: "Circuit breaker tripped — pausing autonomous operation." then STOP.
- [ ] Loop through `activeWork` array — for each item, process by state:
  - `AGENT_RUNNING`: check Claude Code session — if stuck 3+ cycles, comment on Linear ticket and notify human. If completed, transition to `BUILD_CHECK`.
  - `BUILD_CHECK`: run `pnpm typecheck && pnpm build && pnpm test:e2e` in project dir. On pass: create PR, assign Scout as reviewer, move Linear ticket to "In Review by agent" or "In Review" and assign Scout, set `AWAITING_REVIEW`. On fail (< 3 attempts): spawn Claude Code to fix, set `AGENT_RUNNING`. On fail (3+ attempts): create draft PR with failure summary, set `AWAITING_REVIEW`.
  - `AWAITING_REVIEW`: check if PR is merged — if yes, rebase any dependent branches and remove item from `activeWork`. Otherwise no action.
  - `IDLE_BLOCKED`: check if blocking ticket's PR is merged — if yes, rebase branch and transition to `AGENT_RUNNING`.
- [ ] After processing all items: if `activeWork` has fewer than 2 items in `AGENT_RUNNING` or `BUILD_CHECK`, check Linear for next prioritized ticket (no `-A` flag, use `--state backlog --state unstarted`). If found: add to `activeWork` with state `AGENT_RUNNING`, set In Progress, spawn Claude Code with ticket context. If none: HEARTBEAT_OK.
- [ ] Write updated `activeWork` to `memory/agent-state.json` and log transitions to `memory/YYYY-MM-DD.md`.