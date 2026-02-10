# BOOTSTRAP.md

## Purpose
Verify all tool integrations are working before entering normal operation.
Run each check in order. If any step fails, stop and report the failure — do not proceed to normal operation with broken tools.

## Integration Checks

### 1. Linear
- Create a test ticket in the **{{LINEAR_TEAM}}** team with title: `[Bootstrap] Integration test — safe to delete`
- Confirm the ticket was created and note the ticket ID

### 2. GitHub
- Clone this repo: `{{GITHUB_REPO}}`
- Confirm the clone succeeded and you can read the repo contents

### 3. Claude Code
- Create a new branch: `bootstrap/integration-test-YYYY-MM-DD`
- Add a file `bootstrap-test.md` with contents: `Integration test — created by [agent name] on [date]`
- Commit and push the branch
- Open a PR titled `[Bootstrap] Integration test — safe to close`
- Confirm the PR was created and note the PR number

### 4. Cleanup
- Close the PR (do **not** merge)
- Delete the remote branch
- Close the Linear ticket with a comment: `Bootstrap complete — all integrations verified`

## After All Checks Pass
1. Log results to `memory/YYYY-MM-DD.md`:
   ```
   ## Bootstrap
   - Linear: ✅ (ticket ID)
   - GitHub: ✅ (clone OK)
   - Claude Code: ✅ (PR #number opened and closed)
   - All integrations verified at HH:MM
   ```
2. Delete this file (`BOOTSTRAP.md`)
3. Begin normal operation per `AGENTS.md`

## If Any Check Fails
Do **not** delete this file. Log the failure to `memory/YYYY-MM-DD.md` and report to the user immediately. Include the error message and which step failed.
