---
name: eng-queue-handler
description: Handle a ticket from the Linear queue as the Engineering agent. Delegates implementation to coding agent, monitors progress, and manages the ticket lifecycle. Triggered by the openclaw-linear plugin when a ticket enters Titus's queue.
metadata: {"openclaw":{"emoji":"📥"}}
user-invocable: false
---

# Eng Queue Handler

Process a ticket that has arrived in your Linear queue. Your role is to manage the ticket lifecycle and delegate implementation to the coding agent.

## Steps

1. **View the ticket** — Use `linear_issue_view` to read the full ticket: description, acceptance criteria, coding agent prompt, file paths, and any sub-ticket dependencies.

2. **Start work** — Use `linear_issue_update` to set the ticket to "In Progress". Pop the ticket from your queue with `linear_queue`.

3. **Delegate to coding agent** — Spawn coding agent with the ticket's coding agent prompt (or build one from the description if none exists). Let it handle the implementation — do not code directly.

4. **Monitor execution** — Watch for progress. If coding agent is stuck for 3+ heartbeat cycles, use `linear_comment_add` to note the blocker on the ticket and notify {{OWNER_NAME}} on Slack.

5. **Verify and ship** — When coding agent completes, run build/test checks in the project directory.
   - **Pass** → Create a PR. Use `linear_issue_update` to move the ticket to "In Review" and assign Scout. Use `linear_comment_add` to post the PR link on the ticket.
   - **Fail (< 3 attempts)** → Spawn coding agent to fix the errors and re-run.
   - **Fail (3+ attempts)** → Create a draft PR with a failure summary. Use `linear_issue_update` to assign Scout. Use `linear_comment_add` to post the draft PR link on the ticket.

## Notes

- Always use the ticket's coding agent prompt if one was provided during prep. Fall back to building a prompt from the description.
- Each sub-ticket should be implemented independently and result in its own PR.
