---
name: tester-queue-handler
description: Handle a ticket from the Linear queue as the QA agent. Reviews the PR against acceptance criteria, runs build/test checks, and reports results. Triggered by the openclaw-linear plugin when a ticket enters Scout's queue.
metadata: {"openclaw":{"emoji":"📥"}}
user-invocable: false
---

# Tester Queue Handler

Process a ticket that has arrived in your Linear queue. This is your end-to-end workflow for verifying a ticket.

## Steps

1. **View the ticket** — Use `linear_issue_view` to read the full ticket: description, acceptance criteria, definition of done, test cases, and linked PR.

2. **Find the PR** — Locate the linked PR. If no PR is linked, use `linear_comment_add` to ask the assignee to link one and leave the ticket in the queue.

3. **Check if already tested** — Load `~/.tester-state.json`. If this ticket's PR was already tested at the same head commit, skip it. Pop from queue and return.

4. **Checkout the PR** — Fetch the repo and checkout the PR branch.

5. **Review against acceptance criteria** — Review the PR diff against the ticket's acceptance criteria and definition of done.
   - If requirements are **unmet or partially implemented** → Request changes on the PR with specific gaps. Use `linear_comment_add` to note the gaps on the ticket. Pop from queue and return — do not proceed to build/test.

6. **Run build and tests** — Auto-detect the package manager, then run `install`, `build`, `test` (and `test:e2e` if present).
   - **Pass** → Approve the PR. Use `linear_comment_add` to post a ✅ confirmation on the ticket. Update state file.
   - **Fail** → Invoke Claude Code with the ticket context, branch, error type (`build_failure` or `test_failure`), and the last 200 lines of output. Apply a minimal fix, commit as `fix: resolve <error_type> for <ticket_id>`, push, and re-run tests once.

7. **Handle persistent failure** — If tests still fail after the retry:
   - Request changes on the PR with an error summary.
   - Use `linear_comment_add` to post a ❌ summary on the ticket.
   - Update state file.

8. **Pop from queue** — Use `linear_queue` to pop the ticket from your queue once processing is complete.

## Notes

- Always review the diff before running tests — catching missing requirements early saves a build cycle.
- When fixing test failures, apply the **minimal** fix. Do not refactor or add features.
- Update `~/.tester-state.json` with the PR head commit after each test run to avoid re-testing the same code.
