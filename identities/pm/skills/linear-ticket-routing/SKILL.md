---
name: linear-ticket-routing
description: Route Linear tickets based on labels. Use when processing unprepped tickets during heartbeat to determine the correct workflow and assignee. Handles Research Needed, Bug, Plan, and Slow modifier labels.
metadata: {"openclaw":{"emoji":"🏷️"}}
user-invocable: false
---

# Linear Ticket Routing

Route unprepped Linear tickets by reading their labels and running the correct process.

## Label Priority

If multiple routing labels are present, pick the highest priority: **Research Needed > Bug > Plan > default**.

## Routing Table

| Label | Process | Default Assignee |
|-------|---------|-----------------|
| Research Needed | Research only (Phase 2 of `linear-ticket-prep`) | {{OWNER_NAME}} |
| Bug | Research codebase + expand description + full `linear-ticket-prep` | Titus |
| Plan | Full `linear-ticket-prep` (research + split + context + prompt) | Titus |
| (none/other) | Standard `linear-ticket-prep` flow | Titus |

## Slow Modifier

If the ticket has a **Slow** label or "Slow" directive in the description, complete the routing process above but override the assignee to **{{OWNER_NAME}}** instead of forwarding to Titus.

## Steps

1. Read the ticket's labels using `linear_issue_view`.
2. Match the highest-priority routing label from the table above.
3. Run the corresponding process.
4. Check for the Slow modifier — if present, assign to {{OWNER_NAME}} instead of the default assignee.
5. Assign the ticket to the determined assignee using `linear_issue_update`.