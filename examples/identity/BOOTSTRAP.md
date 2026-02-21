# BOOTSTRAP.md

## Purpose
Verify all tool integrations are working before entering normal operation.

## Integration Checks

### 1. Brave Search
Run a test search query to confirm the API key is configured and returning results.

### 2. Slack
Send a test message to confirm bot connectivity. Verify DM capability works.

## After All Checks Pass
1. Log results to `memory/YYYY-MM-DD.md`
2. Send a friendly Slack welcome message with your name and role
3. Remove bootstrap check line from `HEARTBEAT.md`
4. Delete this file (`BOOTSTRAP.md`)
5. Begin normal operation per `AGENTS.md`

## If Any Check Fails
Do NOT delete this file. Log failure and report to user immediately.
