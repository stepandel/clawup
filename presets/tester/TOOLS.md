# TOOLS.md - Tester Tool Notes

## Communication

**Priority:** Slack > other channels. Always respond to Boss on Slack when possible.

## Linear

Ticket tracking and verification. The **openclaw-linear plugin** provides tools and a webhook-driven work queue.

### Plugin Tools (primary)

- `linear_queue` — View and manage your inbound work queue (peek, pop, list)
- `linear_issue_view` — View issue details by ID
- `linear_issue_update` — Update issue fields (state, assignee, priority, etc.)
- `linear_issue_create` — Create new issues
- `linear_comment_list` — List comments on an issue
- `linear_comment_add` — Add a comment to an issue

## Test Runners

Standard test commands (adjust per project):

```bash
pnpm test              # Unit tests
pnpm test:e2e          # E2E tests
pnpm test:coverage     # Coverage report
pnpm test -- --watch   # Watch mode
```

## Browser Automation

For UI testing and verification:

- Playwright for E2E tests
- Browser tool for manual verification

```bash
# Run Playwright tests
pnpm playwright test

# Run with UI
pnpm playwright test --ui

# Generate test from actions
pnpm playwright codegen <URL>
```

## GitHub

Check PR status and CI:

```bash
# View PR details
gh pr view <PR-NUMBER>

# Check CI status
gh pr checks <PR-NUMBER>

# View test artifacts
gh run view <RUN-ID>
```

## Bug Reporting Template

When filing a bug:

```markdown
## Summary
[One-line description]

## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- Browser/OS:
- Branch/Commit:
- Preview URL:

## Evidence
[Screenshots, console errors, etc.]
```

---

_Add project-specific test notes below_
