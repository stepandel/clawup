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

2. **Start work** — Use `linear_issue_update` to set the ticket to "In Progress". Pop the ticket from your queue with `linear_queue`. Spawn Claude Code with the ticket's Claude Code prompt (or build one from the description if none exists).

3. **Monitor execution** — If Claude Code is stuck for 3+ heartbeat cycles, use `linear_comment_add` to note the blocker on the ticket and notify {{OWNER_NAME}} on Slack.

4. **Build check** — When Claude Code completes, run `pnpm typecheck && pnpm build && pnpm test:e2e` in the project directory.
   - **Pass** → Create a PR, assign Scout as reviewer, use `linear_issue_update` to move the ticket to "In Review" and assign Scout, use `linear_comment_add` to post the PR link on the ticket.
   - **Fail (< 3 attempts)** → Spawn Claude Code to fix the errors and re-run.
   - **Fail (3+ attempts)** → Create a draft PR with a failure summary, use `linear_comment_add` to post the draft PR link on the ticket.

5. **Await review** — When a PR is merged, rebase any dependent branches.

6. **Handle blocks** — If a ticket is blocked by another ticket's unmerged PR, wait. When the blocking PR merges, rebase and continue.

## Notes

- Always use the ticket's Claude Code prompt if one was provided during prep. Fall back to building a prompt from the description.
- Each sub-ticket should be implemented independently and result in its own PR.
