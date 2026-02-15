# Heartbeat Checklist

## Always

- [ ] If `BOOTSTRAP.md` exists in workspace, follow it first. Do not continue with the rest of this checklist until bootstrap is complete.
- [ ] Check all open PRs across repos for team {{LINEAR_TEAM}} for unresolved review comments. For each PR with comments, use `pr-review-resolver` skill to parse comments, apply fixes via Claude Code, and push.
- [ ] Load `~/.tester-state.json`. Check open PRs with linked tickets. Skip PRs already tested at same head commit. If none remain → HEARTBEAT_OK.
- [ ] For each untested PR: fetch repo, checkout PR branch.
- [ ] Review PR diff against ticket acceptance criteria. If requirements are unmet or partially implemented, request changes on the PR with specific gaps — skip build/test.
- [ ] Auto-detect package manager, run `install`, `build`, `test` (and `test:e2e` if present). On pass → approve PR, update state file.
- [ ] On build/test failure: invoke Claude Code with ticket context, branch, error type (`build_failure`|`test_failure`), last 200 lines of output. Apply minimal fix, commit as `fix: resolve <error_type> for <ticket_id>`, push, re-run once.
- [ ] If still failing after retry → request changes on PR with error summary, update state file.