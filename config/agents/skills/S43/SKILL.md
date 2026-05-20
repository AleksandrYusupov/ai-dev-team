# S43 — Stakeholder Status Reporter

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Writes audience-aware status summaries for founders, PMs, and eng leads — covering what is moving, where risks lie, what is blocked, and what requires a decision.
- Why: The core reporting skill for ReporterAgent. Without structured, audience-tuned summaries the team defaults to raw data dumps that nobody reads.

## When To Use
- When a workflow phase completes and stakeholders need a progress update with risk highlights.
- When blocked items accumulate and a decision-maker needs a consolidated view to unblock the pipeline.
- When OrchestratorAgent triggers a periodic or milestone-based status report for a project or epic.
- Do NOT use for internal agent-to-agent communication — this skill produces human-facing artifacts, not machine-readable signals.

## Inputs
- Workflow state snapshot: current phase, active tasks, completed tasks, blocked tasks with reasons.
- Risk registry: items flagged by agents or escalation rules, severity, owner, age.
- Decision backlog: open questions that require human input, with context and options where available.
- Audience tag: one of `founder`, `pm`, `eng_lead` — determines tone, detail level, and section emphasis.
- Time window: reporting period (e.g., last 24h, this sprint, since last report).

## Steps

1. **Collect workflow state** — gather current task statuses, phase transitions, and completion percentages from the orchestrator state store for the specified time window.
2. **Extract risk signals** — pull all items tagged as risk, blocked, or escalated. Group by severity (critical, high, medium) and deduplicate entries that appear in multiple agent outputs.
3. **Identify decision points** — collect open questions from the decision backlog that require human input. For each, attach the originating agent, available options, and a recommended default if one exists.
4. **Select audience template** — choose the report structure based on the audience tag: founders get a 3-line executive summary with key metric and top blocker; PMs get full task breakdown with timeline impact; eng leads get technical blockers with dependency details.
5. **Compose sections** — write each section using concise, declarative language. Lead every section with the most important fact. Use bullet lists, not prose paragraphs. Include exactly one "next decision point" per report.
6. **Apply tone calibration** — remove jargon for founder audience, add technical context for eng leads. Ensure every risk statement includes both the impact and a suggested mitigation or escalation path.
7. **Validate completeness** — confirm that the report covers: progress summary, risk highlights, blocked items, and next decision point. If any section is empty, include an explicit "none" marker rather than omitting it.
8. **Emit report artifact** — produce the status report as a typed output artifact with metadata: audience, time window, report fingerprint, and timestamp.

## Stop Conditions
- **Done** when the report contains all four required sections (progress, risks, blockers, decisions) with appropriate audience tone applied.
- **Done** when the next decision point is clearly stated with owner and deadline.
- **Stop early** if no workflow state data is available for the time window — emit a "no data" report rather than fabricating content.

## Escalation Rules
- Escalate when critical blockers have been unresolved for more than the configured SLA threshold.
- Escalate when the decision backlog contains items older than 48 hours without an assigned owner.
- Do NOT escalate for empty risk sections or zero blocked items — that is a valid healthy state.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not write raw data dumps.** Every data point must be summarized into an actionable statement.
- **Do not mix audiences.** One report targets one audience — never combine founder and eng-lead detail levels.
- **Do not invent progress.** If data is missing, say so explicitly rather than interpolating.
- **Do not omit the decision point.** Every report must end with a clear next action, even if it is "no decisions needed."

## Denied Actions
- Do not write code or patches.
- Do not make decisions on behalf of stakeholders — present options, not conclusions.
- Do not include raw agent logs or internal workflow IDs in human-facing reports.
