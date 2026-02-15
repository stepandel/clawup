---
name: pm-queue-handler
description: Handle a ticket from the Linear queue as the PM agent. Routes the ticket by labels, preps it with research/context/sizing, and assigns it to the right agent. Triggered by the openclaw-linear plugin when a ticket enters Juno's queue.
metadata: {"openclaw":{"emoji":"📥"}}
user-invocable: false
---

# PM Queue Handler

Process a ticket that has arrived in your Linear queue. This is your end-to-end workflow for every inbound ticket.

## Steps

1. **View the ticket** — Use `linear_issue_view` to read the full ticket: title, description, labels, comments, parent/child issues, and assignee.

2. **Validate completeness** — If the ticket is missing a description or acceptance criteria, use `linear_comment_add` to ask the assigner for clarification. Do not proceed until the ticket has enough context to route.

3. **Route by labels** — Run the `linear-ticket-routing` skill to determine the correct workflow and assignee based on the ticket's labels (Research Needed, Bug, Plan, Slow, or default).

4. **Prep the ticket** — Run the `linear-ticket-prep` skill to:
   - Validate sizing (split oversized tickets into sub-issues)
   - Research tools, APIs, and SDKs involved
   - Enrich context by scanning the codebase
   - Add definition of done, test cases, and a coding agent prompt
   - Assign to the determined agent (typically Titus)

5. **Confirm completion** — After prep and assignment, use `linear_queue` to pop the ticket from your queue.

## Notes

- If the ticket is already well-prepped (has description, DoD, context), skip straight to routing and assignment.
- If a ticket has the **Slow** label, it gets assigned to {{OWNER_NAME}} instead of an agent — still prep it fully.
- Sub-tickets created during splitting should all be prepped before assignment.
