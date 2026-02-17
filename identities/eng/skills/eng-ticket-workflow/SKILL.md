---
name: eng-ticket-workflow
description: Handle tickets from project management tools and delegate coding tasks to Claude Code. Use when processing tickets, planning implementation, submitting PRs, or coordinating coding work.
metadata: {"openclaw":{"emoji":"🎫","requires":{"bins":["claude"]}}}
---

# Ticket Workflow

Process tickets and delegate coding work to Claude Code. Use good judgment — not every step applies to every ticket.

## Before Starting

1. Read the ticket fully — description, comments, linked context
2. Pull latest from main (`git pull origin main`). Never start on a stale codebase.
3. If anything is ambiguous, ask for clarification before starting work

## Doing the Work

Delegate coding tasks to Claude Code — writing code, fixing bugs, tests, refactors, config changes. When delegating, provide: the goal, relevant file paths/context, acceptance criteria, and what NOT to touch.

**Use the `coding-agent` skill when spawning Claude Code.** It has the correct patterns for PTY mode, background execution, process monitoring, and auto-notify on completion. Key requirements:
- Always use `pty:true` — Claude Code hangs without it
- Use `background:true` + `workdir` for longer tasks
- Monitor with `process action:log sessionId:XXX`
- Append an `openclaw system event` trigger to your prompt so you get notified on completion
- Never start Claude Code in OpenClaw's own directory

Handle yourself: triage, gathering context, writing ticket updates, reviewing output.

If Claude Code's first attempt misses, give targeted follow-up — don't repeat the whole task. If it's going in circles, re-approach differently.

## Before Marking Complete

Every code change requires ALL of these:

1. **Code compiles** — run the build, no errors
2. **Tests pass** — full suite, no regressions
3. **PR submitted** — clear title referencing the ticket, description of what/why, link to ticket
4. **No junk** — no debug logs, commented-out code, or unrelated changes
5. **Ticket updated** — comment with PR link, move status

## Rules of Thumb

- One PR per ticket. Keep PRs small and focused.
- For large tickets, break into sub-tasks and submit incremental PRs
- If a ticket is just a question/discussion, respond — don't open a PR
- If blocked on access or permissions, flag immediately
- Always verify build and tests yourself — don't assume it works