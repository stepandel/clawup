# Heartbeat Checklist

## Always

- [ ] Load `~/.tester-state.json`. Query Linear for tickets in "In Review" or "In Review by Agent" with a linked PR across teams MUL, AGE, PINE. Skip tickets already tested at same PR head commit. If none remain → HEARTBEAT_OK.
- [ ] For each untested ticket: assign yourself on Linear, fetch repo, checkout PR branch.
- [ ] Check PR for unresolved review comments. If any exist, use `/pr-review-responder` skill to parse comments, apply fixes by delegating them to Claude Code, and push before proceeding.
- [ ] Review PR diff against Linear ticket acceptance criteria. If requirements are unmet or partially implemented, comment on Linear with specific gaps and label `needs-work` — skip build/test.
- [ ] Auto-detect package manager, run `install`, `build`, `test` (and `test:e2e` if present). On pass → comment ✅ on Linear ticket, label `qa-passed`, update state file.
- [ ] On build/test failure: invoke Claude Code with ticket context, branch, error type (`build_failure`|`test_failure`), last 200 lines of output. Apply minimal fix, commit as `fix: resolve <error_type> for <ticket_id>`, push, re-run once.
- [ ] If still failing after retry → comment ❌ on Linear ticket with error summary, label `qa-failed`, update state file.