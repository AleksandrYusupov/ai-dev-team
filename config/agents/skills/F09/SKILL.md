# F09 — Decision Log & Memory Skill

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Maintains a compact decision log for a task area: what decisions were made, when, by whom, on what basis. Supports incremental updates and deduplication with comment thread distillation.
- Why: Reduces repeated questions and lets agents skip pulling entire conversation threads. Decisions survive context window boundaries.

## When To Use
- When building a context pack that needs historical decision context for the task's area or component.
- When a task re-enters a workflow phase (e.g., moved from `needs_spec` back to `planned`) and prior decisions need to be preserved.
- When merging decisions from comment thread distillation (S05) with previously recorded decisions.
- Do NOT use as a general-purpose note-taking tool — this skill is specifically for structured decision records.

## Inputs
- Task area/component identifier (from issue contract or repo mapping).
- Prior decision log entries (if this is a re-invocation or continuing context).
- Distilled comment decisions (from S05, if available).
- Relevant ADR/spec decisions (from S04, if applicable).

## Steps

1. **Query existing decisions** — search for prior decision log entries related to the task's area, component, or service. Sources: previous context packs, agent changelog entries, ADR decisions.
2. **Structure each entry** — for every decision found, capture:
   - `timestamp`: when the decision was made (ISO 8601)
   - `actor`: who made it (human or agent role)
   - `decision`: what was decided (one sentence)
   - `rationale`: why (evidence, constraints, tradeoffs)
   - `evidence`: references used (Obsidian links, PR refs, test results)
   - `supersedes`: ID of prior decision this replaces (if any)
   - `unresolved_questions`: open items related to this decision
3. **Merge with comment distillation** — if S05 produced distilled decisions, merge them into the log. Deduplicate by matching decision content and timestamp proximity.
4. **Mark superseded entries** — if a newer decision explicitly overrides an older one, mark the older entry as superseded and link to the replacement.
5. **Identify unresolved questions** — collect all open questions that have not been answered by any decision. These become `known_unknowns` in the context pack.
6. **Produce incremental update** — if this is a re-invocation, produce only the delta (new decisions, newly superseded entries, newly resolved questions) rather than rebuilding from scratch.
7. **Emit structured log** — output the decision log as a structured list ready for inclusion in the context pack.

## Stop Conditions
- **Done** when all available decision sources have been queried and the log is structured, deduplicated, and has supersession links resolved.
- **Done** when unresolved questions are collected and ready for the `known_unknowns` section.
- **Stop early** if no decision sources exist for this area — emit an empty log with a note explaining the absence.

## Escalation Rules
- Escalate when two decisions directly contradict each other and neither is marked as superseding the other.
- Escalate when a decision references a human gate that was bypassed without audit trail.
- Do NOT escalate for areas with no prior decisions — this is normal for new features.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not treat all comments as decisions.** Only structured choices with rationale qualify as decisions.
- **Do not keep superseded decisions at the same prominence as current ones.** Mark them clearly.
- **Do not fabricate decision history.** If no decisions exist, say so.
- **Do not store raw comment text.** Structure and summarize.

## Denied Actions
- Do not write code or patches.
- Do not make decisions — this skill records and retrieves decisions made by others.
