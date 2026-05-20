# S07 — Acceptance Criteria Engineer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Преобразует vague request в тестируемые acceptance criteria и done_when.
- Why: Без этого build/test дрейфуют.

## When To Use
- When an issue contract has a vague or missing `acceptance_criteria` field and needs testable criteria before build agents can start.
- When S06 (Issue Contract Generator) delegates AC generation because the brief lacks concrete success conditions.
- When a task is being re-scoped and existing acceptance criteria need to be revised to match the new scope.
- Do NOT use when acceptance criteria are already concrete, testable, and aligned with the scope — validate with a quick completeness check instead.

## Inputs
- Issue contract (from S06 output or F01 parse) — provides goal, scope, non_goals, and any existing partial AC.
- Task brief or raw request text (from issue body or comments — the original human intent).
- Architecture context (from S04 — Docs & ADR Retriever — provides constraints, invariants, SLAs that AC must respect).
- Repo test infrastructure info (from AGENTS.md repo guidance — what test frameworks and commands exist).

## Steps

1. **Extract success signals from the goal** — decompose the issue contract `goal` into observable outcomes. Ask: "What would a user see, what would a developer verify, what would ops monitor if this task is done correctly?"
2. **Classify criteria into three tiers**:
   - **User-facing AC**: what the end user observes (UI state, API response, behavior change). Format: "Given [context], when [action], then [observable result]."
   - **Engineering AC**: what must be true in code and data (schema migration applied, endpoint returns correct shape, no regression in existing tests). Format: "[Component/module] [verb] [measurable condition]."
   - **Operational AC**: what must hold post-deploy (error rate below threshold, latency within SLA, alerts configured). Format: "[Metric] [comparison] [threshold] for [duration]."
3. **Apply measurability filter** — for each criterion, verify it can be checked by at least one of: running a command, inspecting a UI state, querying a database, or reading a metric. Rewrite any criterion that fails this test.
4. **Cross-check against non_goals** — ensure no AC implies work that is listed in `non_goals`. Remove or flag contradictions.
5. **Cross-check against architectural constraints** — verify AC does not violate invariants from ADRs or specs (e.g., AC cannot require synchronous calls if the architecture mandates async).
6. **Generate done_when statement** — synthesize a single, unambiguous completion condition from the AC set. This must be a boolean-evaluable statement: "Task is done when ALL of the following are true: [list]."
7. **Map AC to verification_path slots** — for each criterion, note the verification method (unit test, integration test, manual check, monitoring query) so S08 can build the concrete proof path.
8. **Emit structured output** — produce the AC set in a format compatible with the issue contract `acceptance_criteria` field and the `done_when` field. Each AC entry includes: id, tier, criterion text, verification method.

## Stop Conditions
- **Done** when every AC is measurable, tier-classified, and mapped to a verification method.
- **Done** when `done_when` is a concrete boolean statement derived from the AC set.
- **Stop early** if the goal is too ambiguous to derive even one testable criterion — escalate for human clarification.
- **Stop early** if non_goals contradict the goal, making AC generation impossible without scope resolution.

## Escalation Rules
- Escalate when the goal statement is circular or self-referential ("make it better", "improve performance" without baseline).
- Escalate when required SLAs or thresholds are not specified and cannot be inferred from architecture docs.
- Escalate when user-facing AC requires access to systems or environments not available to the agent team.
- Do NOT escalate for missing operational AC on low-risk tasks — note the gap and proceed with user-facing and engineering AC.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not write vague criteria.** "It should work correctly" is not an AC. Every criterion must specify what, how to check, and what the expected result is.
- **Do not mix tiers.** Keep user-facing, engineering, and operational criteria in separate sections.
- **Do not embed implementation details in AC.** Criteria describe outcomes, not how to achieve them.
- **Do not generate AC that cannot be verified.** If you cannot name a command, query, or UI check for a criterion, it is not testable — rewrite or escalate.
- **Do not ignore non_goals.** AC that implies out-of-scope work causes downstream agents to over-build.

## Denied Actions
- Do not write test code — this skill produces criteria specifications, not test implementations.
- Do not modify the issue scope or goal — if scope changes are needed, escalate to SpecAgent.
- Do not execute verification steps — that is S08 and F05's responsibility.
