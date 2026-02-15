---
name: eng-queue-handler
description: Handle a ticket from the Linear queue as the Engineering agent. Implements the ticket using Claude Code, runs build/test checks, creates a PR, and hands off for review. Triggered by the openclaw-linear plugin when a ticket enters Titus's queue.
metadata: {"openclaw":{"emoji":"📥"}}
user-invocable: false
---

# Eng Queue Handler

Process a ticket that has arrived in your Linear queue. This is your end-to-end workflow for implementing a ticket.

## Steps

1. **View the ticket** — Use `linear_issue_view` to read the full ticket: description, acceptance criteria, Claude Code prompt, file paths, and any sub-ticket dependencies.

2. **Check capacity** — Load `memory/agent-state.json`. If `activeWork` already has 2+ items in `AGENT_RUNNING` or `BUILD_CHECK` state, do not pick up this ticket yet — leave it in the queue and return. (`AWAITING_REVIEW` items do NOT count toward the cap.)

3. **Start work** — Add the ticket to `activeWork` with state `AGENT_RUNNING`. Use `linear_issue_update` to set the ticket to "In Progress". Spawn Claude Code with the ticket's Claude Code prompt (or build one from the description if none exists).

4. **Monitor execution** — If Claude Code is stuck for 3+ heartbeat cycles, use `linear_comment_add` to note the blocker on the ticket and notify {{OWNER_NAME}} on Slack.

5. **Build check** — When Claude Code completes, run `pnpm typecheck && pnpm build && pnpm test:e2e` in the project directory.
   - **Pass** → Create a PR, assign Scout as reviewer, use `linear_issue_update` to move the ticket to "In Review" and assign Scout, use `linear_comment_add` to post the PR link on the ticket. Set state to `AWAITING_REVIEW`.
   - **Fail (< 3 attempts)** → Spawn Claude Code to fix the errors. Set state back to `AGENT_RUNNING`.
   - **Fail (3+ attempts)** → Create a draft PR with a failure summary, use `linear_comment_add` to post the draft PR link on the ticket. Set state to `AWAITING_REVIEW`.

6. **Await review** — When a PR is merged, rebase any dependent branches and remove the item from `activeWork`.

7. **Handle blocks** — If a ticket is blocked by another ticket's unmerged PR, set state to `IDLE_BLOCKED`. Check periodically — when the blocking PR merges, rebase and transition back to `AGENT_RUNNING`.

8. **Persist state** — Write updated `activeWork` to `memory/agent-state.json` and log transitions to `memory/YYYY-MM-DD.md`.

9. **Pop from queue** — Use `linear_queue` to pop the ticket from your queue once work has started.

## Notes

- Always use the ticket's Claude Code prompt if one was provided during prep. Fall back to building a prompt from the description.
- If consecutive errors reach 3 (`consecutiveErrors >= 3` in state file), notify {{OWNER_NAME}} on Slack with "Circuit breaker tripped — pausing autonomous operation" and stop processing.
- Each sub-ticket should be implemented independently and result in its own PR.
