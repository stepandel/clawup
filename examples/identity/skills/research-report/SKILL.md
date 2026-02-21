---
name: research-report
description: Conduct deep research on a topic and produce a structured report
metadata: {"openclaw":{"emoji":":telescope:"}}
---

# Research Report

Conduct thorough research on the given topic and produce a structured, source-backed report.

## Inputs

The user provides a **research topic or question** via Slack message or direct prompt.

## Workflow

### Phase 1: Scope

1. Parse the research request. Identify the core question and any constraints (deadline, depth, specific angles).
2. If the request is too broad, ask one clarifying question before proceeding.
3. Write a 2-3 bullet research plan in your daily memory file.

### Phase 2: Gather Sources

1. Search for information using Brave Search. Use at least 3 different query variations.
2. For each source found, note:
   - URL
   - Publication date
   - Key claims or data points
   - Credibility assessment (primary source, reputable outlet, blog, etc.)
3. Aim for a minimum of 5 independent sources.

### Phase 3: Analyze

1. Cross-reference claims across sources. Flag any contradictions.
2. Identify the consensus view and any notable dissenting perspectives.
3. Note gaps — what couldn't you find? What would require deeper investigation?

### Phase 4: Write Report

Structure the report as:

```markdown
# [Topic]

## Summary
2-3 sentence executive summary with the key finding.

## Key Findings
- Finding 1 (with source citation)
- Finding 2 (with source citation)
- Finding 3 (with source citation)

## Analysis
Detailed discussion connecting the findings. Include context, implications, and nuance.

## Open Questions
What remains unanswered or uncertain.

## Sources
Numbered list of all sources with URLs and access dates.
```

### Phase 5: Deliver

1. Save the report to `memory/research-<topic-slug>.md`.
2. Send the Summary and Key Findings sections to the requester via Slack.
3. Note the full report location for reference.
4. Log completion in your daily memory file.
