# S01 — Triage Classifier

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- Why: Основа IntakeAgent.

## When To Use
- When a new issue arrives and needs classification before any downstream agent can act.
- When an existing issue is reopened or significantly edited and its classification may have changed.
- When OrchestratorAgent needs to decide the next workflow phase and no triage result exists yet.
- Do NOT use for re-prioritization of already-triaged issues — that is an orchestration decision, not classification.

## Inputs
- Raw issue payload: title, description, labels, author, creation timestamp (from Linear webhook or manual trigger).
- Repository metadata: repo name, primary language, affected service area (from project registry).
- Historical triage patterns: past classification decisions for similar titles/descriptions (from issue corpus via S02 results if available).
- Caller context: which agent invoked the classifier and what downstream decision depends on the result.

## Steps

1. **Extract signals** — parse the issue title, description, and any attached labels or metadata. Identify explicit markers (e.g., `[bug]` prefix, `P0` label, `migration` keyword) and implicit signals (stack traces indicate bug, "would be nice" indicates feature).
2. **Classify type** — assign exactly one primary type from the canonical set: `bug`, `feature`, `chore`, `spike`, `integration`, `migration`, `infra`. If the issue spans multiple types, pick the dominant one and note secondary types in the rationale.
3. **Assess risk** — evaluate risk as `low`, `medium`, `high`, or `critical` based on: blast radius (number of affected services), reversibility (can this be rolled back?), user impact (percentage of users affected), and time sensitivity (SLA or deadline pressure).
4. **Determine source** — classify origin as `user` (external report, support ticket), `monitoring` (alert, anomaly detection), `dependency` (upstream library update, CVE), or `internal` (tech debt, refactor request, team initiative).
5. **Assign mode and area** — mode is the execution shape: `solo` (single agent), `multi` (cross-agent coordination), `human-in-loop` (requires approval gates). Area maps to the affected domain boundary from the project registry.
6. **Compute confidence** — produce a confidence score (0.0-1.0) for the overall classification. Confidence drops when: description is vague (<50 words), multiple types are equally likely, risk indicators conflict, or area cannot be determined from context.
7. **Route on confidence** — if confidence >= 0.7, emit the classification and set next status to `ready_for_spec` or `ready_for_plan` depending on type. If confidence < 0.7, set next status to `needs_input` and trigger S03 (Clarifying Questions Composer) with the specific ambiguities identified.
8. **Emit triage artifact** — produce a structured output containing: `type`, `risk`, `source`, `mode`, `area`, `confidence`, `rationale`, `next_status`, `secondary_types[]`, `ambiguities[]`.

## Stop Conditions
- **Done** when the triage artifact is emitted with all required fields populated and confidence score computed.
- **Done** when confidence < 0.7 and S03 has been triggered with the list of ambiguities.
- **Stop early** if the issue payload is empty or unparseable — escalate rather than guessing.

## Escalation Rules
- Escalate when the issue description is empty and no labels or metadata provide classification signals.
- Escalate when risk is assessed as `critical` — critical issues require human confirmation before routing.
- Do NOT escalate for low-confidence classifications — route to S03 for clarification instead.

## Anti-Patterns
- **Do not default to `feature` when uncertain.** Low confidence should route to S03, not produce a guess.
- **Do not classify based solely on labels.** Labels are hints, not ground truth — always cross-reference with the description.
- **Do not split a single issue into multiple classifications.** One issue gets one primary type; note secondary types in rationale only.
- **Do not skip risk assessment for chores.** Even `chore` tasks can be high-risk if they touch critical infrastructure.

## Denied Actions
- Do not modify the issue content, labels, or assignee — classification is read-only.
- Do not trigger downstream agents directly — emit the triage artifact and let OrchestratorAgent decide routing.
- Do not access external services (GitHub, Linear API) — work only with the payload provided as input.
