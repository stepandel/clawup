---
name: pr-review-resolver
description: Address review comments on a GitHub PR. Triages each comment as resolve-as-suggested, resolve-differently, or ignore, using project context from Linear tickets. Use when asked to go over PR review comments, address feedback, or resolve PR discussions.
metadata: {"openclaw":{"emoji":"🔍"}}
---

# PR Review Comment Resolver

Systematically address all review comments on a GitHub pull request. For each comment, exercise judgement to resolve it via the suggested approach, an alternative approach, or mark it as intentionally ignored.

## Workflow

### 1. Gather Context

Fetch the PR diff and all review comments:

```
gh pr view <number> --json title,body,headBranch,baseBranch
gh pr diff <number>
gh api repos/{owner}/{repo}/pulls/<number>/comments --paginate
gh api repos/{owner}/{repo}/pulls/<number>/reviews --paginate
```

Identify any linked Linear tickets from the PR body or branch name. Read them to understand the intent, acceptance criteria, and scope of the change. This context is critical for judging whether a review comment is in-scope or out-of-scope.

### 2. Triage Each Comment

For every unresolved review comment, classify it into one of three categories:

**A) Resolve — suggested approach**
The reviewer's suggestion is correct and well-scoped. Apply it as-is or with minimal adjustment.
- Criteria: The suggestion fixes a real bug, improves clarity, matches project conventions, or satisfies acceptance criteria.
- Action: Make the exact change suggested (or very close to it). Resolve the thread.

**B) Resolve — different approach**
The reviewer identified a real issue, but a better solution exists.
- Criteria: The suggestion would introduce regressions, is overly complex, conflicts with architectural decisions, or there's a simpler/more idiomatic fix.
- Action: Implement the alternative fix. Leave a reply explaining what you did instead and why. Resolve the thread.

**C) Ignore**
The comment does not warrant a code change on this PR.
- Criteria: The suggestion is out-of-scope for the ticket, based on a misunderstanding of the requirements, a stylistic nit that contradicts project conventions, or would cause scope creep.
- Action: Leave a respectful reply explaining why you're not making the change. Do NOT resolve the thread — let the reviewer decide.

### 3. Decision Framework

When triaging, weigh these factors in order:

1. **Correctness** — Does the comment identify a real bug or logic error? If yes, always resolve (A or B).
2. **Ticket scope** — Does the change align with the Linear ticket's acceptance criteria? Out-of-scope improvements should generally be ignored (C) or noted for a follow-up ticket.
3. **Project conventions** — Does the suggestion align with existing patterns in the codebase? Prefer consistency over personal preference.
4. **Complexity vs. value** — Is the effort proportional to the improvement? Trivial fixes: always do them. Large refactors: probably out-of-scope (C).
5. **Reviewer authority** — Comments from the codeowner or tech lead carry more weight than drive-by suggestions. Factor this into borderline decisions.

### 4. Apply Changes

Make all code changes on the current branch. Group related changes into a single commit with a clear message:

```
git add -A
git commit -m "address pr review comments"
git push
```

### 5. Summarize

After processing all comments, provide a summary table:

| # | File | Comment (short) | Decision | Rationale |
|---|------|-----------------|----------|-----------|
| 1 | src/api/handler.ts | Add null check | A — Resolved as suggested | Real bug, edge case missed |
| 2 | src/db/query.ts | Extract to helper | B — Resolved differently | Used existing util instead |
| 3 | src/ui/form.tsx | Refactor to hook | C — Ignored | Out-of-scope, filed follow-up |

## Edge Cases

- **Conflicting comments**: If two reviewers disagree, favor the codeowner's position. If neither is a codeowner, pick the approach that's most consistent with existing patterns and note the conflict.
- **Stale comments**: If the code a comment references has already been changed (e.g., by a subsequent commit), verify whether the concern still applies to the current code before acting.
- **Approval-blocking comments**: If a reviewer left a "Request Changes" review, prioritize their comments — they're gatekeeping merge.
- **Questions (not suggestions)**: Reply with a clear answer. Don't make code changes unless the question reveals an actual issue.

## Notes

- Always read linked Linear tickets before triaging. Requirements context prevents unnecessary churn.
- Prefer small, focused changes. Don't refactor surrounding code while addressing a comment unless the comment specifically asks for it.
- When choosing option B, keep replies concise — explain what you did and why in 1-2 sentences, not a paragraph.
- When choosing option C, be respectful. Acknowledge the reviewer's point and explain your reasoning. Suggest a follow-up ticket if the idea has merit but is out-of-scope.