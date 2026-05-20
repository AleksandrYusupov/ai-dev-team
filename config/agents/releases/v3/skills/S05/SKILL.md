# S05 — Comment Thread Distiller

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Compresses long comment threads into a canonical decisions summary with unresolved questions, superseded items, and structured timeline.
- Why: Significant context savings and reduced decision loss. Long threads consume context window and hide critical decisions in noise.

## When To Use
- When an issue has a comment history that needs to be distilled before inclusion in a context pack.
- When a long thread contains buried decisions that downstream agents need to know about.
- When a task has been discussed extensively and the conversation needs to be compressed into actionable items.
- Do NOT use for threads with fewer than 3 comments — at that scale, include them directly.

## Inputs
- Comment thread: ordered list of comments with timestamps, authors, and content.
- Issue contract: task context (type, area, component) for relevance scoring.
- Prior distillation (if re-invoking): previous distilled output to merge with new comments.

## Steps

1. **Read the full thread** — process all comments in chronological order. Identify:
   - Decisions (explicit choices made with rationale)
   - Questions (asked but not yet answered)
   - Answers (responses to prior questions)
   - Action items (assigned work or next steps)
   - Status updates (progress reports, blockers)
   - Noise (greetings, acknowledgments, off-topic discussion)
2. **Build structured timeline** — for each meaningful item, record:
   - `timestamp`: when it was posted (ISO 8601)
   - `speaker`: who posted it (human name or agent role)
   - `type`: decision | question | answer | action_item | status_update
   - `content`: one-sentence summary
   - `references`: links or mentions to other items
3. **Extract canonical decisions** — from all decisions found:
   - Deduplicate (same decision restated multiple times → keep the most authoritative version)
   - Link answers to their questions (mark questions as resolved when answered)
   - Identify superseded decisions (earlier choice overridden by a later one)
4. **Identify unresolved questions** — collect all questions that remain unanswered or partially answered. These become `known_unknowns`.
5. **Identify open action items** — collect action items that have not been marked complete.
6. **Produce distilled output** — structure the result as:
   - `resolved_decisions`: list of current, active decisions with rationale
   - `superseded_decisions`: list of overridden decisions (for audit trail)
   - `unresolved_questions`: list of open questions
   - `open_action_items`: list of pending work
   - `thread_summary`: 2-3 sentence summary of the overall discussion
   - `comment_count`: original thread length vs distilled item count
7. **Handle incremental updates** — if this is a re-invocation with new comments since last distillation:
   - Process only new comments since the last distillation timestamp
   - Merge new items into the existing distilled structure
   - Update resolved/superseded status based on new information

## Stop Conditions
- **Done** when all comments have been processed and the distilled output is structured.
- **Done** when decisions, questions, and action items are categorized and deduplicated.
- **Skip** if the thread has fewer than 3 comments — pass them through without distillation.
- **Stop early** if the thread is entirely noise (greetings, acknowledgments) — emit an empty distillation with a note.

## Escalation Rules
- Escalate when the comment thread contains conflicting decisions from different human stakeholders that have not been explicitly resolved.
- Escalate when a decision references a human gate that appears to have been bypassed.
- Do NOT escalate for long threads — length is expected. Escalate only for semantic conflicts.
- Do NOT escalate for unanswered questions — they become `known_unknowns`, not escalations.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not include raw comment text in the output.** Summarize each item in one sentence.
- **Do not treat all comments as equally important.** Decisions and questions matter more than status updates and greetings.
- **Do not lose superseded decisions.** They are audit trail — include them in the superseded section.
- **Do not invent decisions.** If a discussion didn't reach a conclusion, mark it as an unresolved question.
- **Do not include sensitive data from comments.** If comments contain credentials or tokens, redact them (defer to F13 if needed).

## Denied Actions
- Do not write or modify comments — this skill is read-only.
- Do not make decisions on behalf of the thread participants.
- Do not delete or hide comments.
