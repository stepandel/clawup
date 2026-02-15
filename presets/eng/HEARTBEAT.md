# Heartbeat Checklist

## Always

- [ ] If `BOOTSTRAP.md` exists in workspace, follow it first. Do not continue with the rest of this checklist until bootstrap is complete.
- [ ] Load `memory/agent-state.json`. If `consecutiveErrors >= 3`, notify Boss on Slack: "Circuit breaker tripped — pausing autonomous operation." then STOP.
- [ ] Loop through `activeWork` array — for each item, process by state:
  - `AGENT_RUNNING`: check Claude Code session — if stuck 3+ cycles, notify human. If completed, transition to `BUILD_CHECK`.
  - `BUILD_CHECK`: run `pnpm typecheck && pnpm build && pnpm test:e2e` in project dir. On pass: create PR, assign Scout as reviewer, set `AWAITING_REVIEW`. On fail (< 3 attempts): spawn Claude Code to fix, set `AGENT_RUNNING`. On fail (3+ attempts): create draft PR with failure summary, set `AWAITING_REVIEW`.
  - `AWAITING_REVIEW`: check if PR is merged — if yes, rebase any dependent branches and remove item from `activeWork`. Otherwise no action.
  - `IDLE_BLOCKED`: check if blocking ticket's PR is merged — if yes, rebase branch and transition to `AGENT_RUNNING`.
- [ ] Write updated `activeWork` to `memory/agent-state.json` and log transitions to `memory/YYYY-MM-DD.md`.