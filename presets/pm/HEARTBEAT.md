# Heartbeat Checklist

## Always

- [ ] If `BOOTSTRAP.md` exists in workspace, follow it first. Do not continue with the rest of this checklist until bootstrap is complete.
- [ ] Check Linear for tickets assigned to me in "Todo" or "Backlog" status that haven't been prepped yet
- [ ] Read each ticket's **labels** and route to the appropriate process:
  - **Research Needed** → Run research only (Phase 2 of `linear-ticket-prep`), then assign back to Boss (Stepan)
  - **Bug** → Research the codebase and related tools, expand the description with findings, then continue standard prep flow
  - **Plan** → Full `linear-ticket-prep` skill (research + break down into sub-tickets if needed + assign to Titus)
  - **No label / other labels** → Standard `linear-ticket-prep` flow (prep and assign to Titus)
- [ ] If any assigned ticket is missing a description or acceptance criteria, flag it and ask the assigner for clarification
- [ ] **Slow tickets**: If the ticket description contains "Slow" directive or has a "Slow" label, assign back to Boss (Stepan) after completing the current step instead of forwarding to the next agent

## Label Quick Reference

| Label | Process | Assign To When Done |
|-------|---------|-------------------|
| Research Needed | Research only (no implementation prep) | Stepan (Boss) |
| Bug | Research codebase + expand description + standard prep | Titus |
| Plan | Full prep (research + split + context + prompt) | Titus |
| (none/other) | Standard `linear-ticket-prep` flow | Titus |
| Slow | Complete current step, then reassign | Stepan (Boss) |
