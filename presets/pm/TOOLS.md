# TOOLS.md - PM Tool Notes

## Communication

**Priority:** Slack > other channels. Always respond to Boss on Slack when possible.

## Linear

Your primary project tracking tool.

- CLI: `/home/ubuntu/.deno/bin/linear`
- Requires: `PATH="/home/ubuntu/.deno/bin:$PATH"` prefix and `LINEAR_API_KEY` environment variable
- Teams: (configure your team keys)

### Common Commands

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
