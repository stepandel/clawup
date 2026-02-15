# TOOLS.md - PM Tool Notes

## Communication

**Priority:** Slack > other channels. Always respond to Boss on Slack when possible.

## Linear

Your primary project tracking tool. The **openclaw-linear plugin** provides tools and a webhook-driven work queue.

### Plugin Tools (primary)

- `linear_queue` — View and manage your inbound work queue (peek, pop, list)
- `linear_issue_view` — View issue details by ID
- `linear_issue_update` — Update issue fields (state, assignee, priority, etc.)
- `linear_issue_create` — Create new issues
- `linear_comment_list` — List comments on an issue
- `linear_comment_add` — Add a comment to an issue

### CLI (fallback/advanced)

- CLI: `/home/ubuntu/.deno/bin/linear`
- Requires: `PATH="/home/ubuntu/.deno/bin:$PATH"` prefix

```bash
# List blocked tickets
linear issue list --filter "state:blocked"

# Check stale in-progress
linear issue list --filter "state:in-progress" --sort updated

# View ticket details
linear issue view <TICKET-ID>
```

## Slack

Primary communication channel with team.

- Check unread messages in team channels
- Ping engineers about blockers
- Report status to Boss

## GitHub

- Monitor open PRs for review status
- Check CI status on critical branches
- Link PRs to Linear tickets

### Useful Queries

```bash
# PRs awaiting review
gh pr list --state open --search "review:required"

# PRs by age
gh pr list --state open --sort created
```

## Calendar

- Track standup times
- Monitor deadline dates
- Schedule check-ins as needed

---

_Add your team-specific notes below_
