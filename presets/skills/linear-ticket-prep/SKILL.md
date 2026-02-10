---
name: linear-ticket-prep
description: Prep Linear tickets for a coding agent. Validates sizing (splits oversized tickets into sub-issues), enriches context by scanning the codebase, and generates a focused Claude Code prompt. Use when starting work on a Linear ticket or when asked to prep/triage tickets.
metadata: {"openclaw":{"emoji":"📋"}}
---

# Linear Ticket Prep

Prepare Linear tickets so a coding agent can execute them cleanly. Three phases: **Size → Context → Prompt**.

Use the existing Linear skill for all API operations.

## Phase 1: Size Check

Fetch the ticket with comments and child issues. A well-sized ticket is completable in a single focused coding session (~1–4 hours of agent work).

### Existing sub-tickets
If child issues exist, fetch and read each one for context. Then use judgment:
- **Well-scoped and cover the work** → skip splitting, run Phase 2–3 per sub-ticket
- **Vague or missing detail** → enrich them in Phase 2 rather than creating new ones
- **Only cover part of the work** → create additional sub-issues for uncovered scope
- **Overlap or conflict** → update the description with a cleaner breakdown proposal
- **Parent is a tracking/epic** → treat each sub-ticket as its own prep target

### Sizing heuristics
Too large if: touches 3+ unrelated modules, has independently shippable backend+frontend work, contains multiple distinct deliverables, estimate >3 points, or uses language like "refactor entire"/"migrate all"/"rewrite".

If oversized, split into independently shippable sub-issues and update the parent description explaining the rationale.

## Phase 2: Context Enrichment

Ensure the ticket has enough info for a coding agent to start without guessing.

### 2a. Gather context
Read the ticket description, comments, linked PRs/docs, and parent/child relationships. Then scan the codebase to find relevant files, entry points, and existing patterns.

### 2b. Update ticket description
Every ticket MUST have all of the following. If any are missing, **append to the ticket description** (preserve existing content, do not use comments).

- **Relevant file paths** the agent should modify
- **Key function/component names** to look at
- **Related code patterns** to follow for consistency
- **Edge cases** discovered while scanning
- **Dependencies** or ordering constraints
- **Definition of Done** — checkboxes with objectively verifiable conditions, not vague "works correctly" statements
- **Test Cases** — concrete input→output scenarios covering happy path, edge cases, and error cases. Check existing test files for naming conventions and patterns.

## Phase 3: Claude Code Prompt

Generate a 1–2 sentence prompt for Claude Code. It must be specific, actionable, and reference concrete file paths, function names, or line numbers — not ticket jargon.

**Formula:** [Action verb] [specific thing] in [specific location], [following pattern/constraint].

Add the prompt to the ticket description (not as a comment).

## Phase 4: Assign to Coding Agent

After the ticket is fully prepped (has context, DoD, test cases, and Claude Code prompt), assign it to **Atlas** (the lead engineer coding agent).

Atlas's Linear user ID: `2a03fa1b-5322-4ca9-9073-76fade211a95`

Use the Linear API to assign:
```graphql
mutation { issueUpdate(id: "TICKET-ID", input: { assigneeId: "2a03fa1b-5322-4ca9-9073-76fade211a95" }) { success } }
```

## Output Summary

After all phases, report:
1. **Sizing**: Well-sized ✅ or Split into N sub-issues 🔀
2. **Context added**: What was missing and enriched
3. **Definition of Done**: The checklist
4. **Test Cases**: The scenarios
5. **Claude Code prompt**: The final prompt
6. **Assigned to**: Atlas ✅

## Notes
- **Always append to the ticket description** — preserve existing content (screenshots, original context), never use comments.
- Scan the actual codebase — don't guess file paths.
- Each sub-issue must be independently mergeable. No intermediate broken states.
- If the ticket references external APIs/services, note relevant docs in the description.
