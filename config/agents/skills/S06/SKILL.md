# S06 — Issue Contract Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Генерирует строгий issue contract / frontmatter из brief или комментариев.
- Why: База SpecAgent.

## When To Use
- When a new issue or task brief arrives and needs a structured contract before downstream agents can act.
- When an existing issue has incomplete or missing frontmatter fields and needs to be brought to spec.
- When an integration task requires extended contract fields (provider, auth, credentials, rollback).
- Do NOT use when the issue already has a complete, validated contract — use F01 (Issue Contract Parser) to verify first.

## Inputs
- Raw brief or task description (from issue body, Slack message, or human comment).
- Parsed existing contract state (from F01 — Issue Contract Parser output, may be empty or partial).
- Repo mapping and project profile (from F10 or AGENTS.md — provides primary_repo, affected_repos context).
- Optional: architecture context pack (from S04 — Docs & ADR Retriever, for dependencies and risk assessment).

## Steps

1. **Parse existing state** — invoke F01 (Issue Contract Parser) on the current issue to extract any existing frontmatter fields. Record which fields are present, which are empty, and which are missing entirely.
2. **Extract intent from brief** — analyze the raw brief or comments to identify: the core goal, background context, what is in scope, and what is explicitly out of scope. Map natural language to structured fields.
3. **Detect task type** — classify the task as one of: feature, bugfix, refactor, integration, infrastructure, documentation. If the type is `integration`, activate the extended field set.
4. **Populate core fields** — fill each required field:
   - `goal`: one sentence stating what the task achieves
   - `background`: why this task exists, what triggered it
   - `scope`: concrete list of what is included
   - `non_goals`: explicit exclusions to prevent scope creep
   - `acceptance_criteria`: delegate to S07 if criteria are vague
   - `verification_path`: delegate to S08 for technical proof steps
   - `docs_links`: references to relevant ADRs, specs, runbooks
   - `primary_repo`: the main repository for this work
   - `affected_repos`: other repos that will be touched
   - `dependencies`: upstream blockers or required preconditions
   - `risk`: low / medium / high with one-line justification
   - `done_when`: concrete completion statement
   - `open_questions`: unresolved items that need human input
5. **Populate integration fields** (if task type is `integration`) — add:
   - `provider_name`, `integration_kind` (API / webhook / OAuth / SDK)
   - `auth_scheme`, `required_credentials`, `secret_slots`
   - `required_scopes`, `oauth_redirect_uris`, `webhook_callback_urls`
   - `test_strategy`, `go_live_checklist`, `rollback_plan`
6. **Validate completeness** — check every required field against a completeness rule: non-empty, non-placeholder, internally consistent. Flag fields that contain TODO or placeholder text.
7. **Flag missing required fields** — for any field that cannot be inferred from the brief, add it to `open_questions` with a specific prompt for the human (e.g., "What is the primary repo for this task?").
8. **Emit structured contract** — output the contract as YAML frontmatter block, machine-readable and ready for insertion into the issue body.

## Stop Conditions
- **Done** when all required fields are populated and validated, or explicitly flagged in `open_questions`.
- **Done** when the contract is emitted as valid YAML frontmatter.
- **Stop early** if the brief is too ambiguous to extract even a `goal` — escalate for human clarification.
- **Stop early** if F01 reports the contract is already complete and no updates are needed.

## Escalation Rules
- Escalate when the brief contains contradictory requirements that cannot be resolved by inference.
- Escalate when critical fields (`goal`, `primary_repo`, `acceptance_criteria`) cannot be populated from available inputs.
- Escalate when risk is assessed as `high` and no `rollback_plan` or mitigation is evident.
- Do NOT escalate for missing optional fields — populate `open_questions` instead.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not invent acceptance criteria from thin air.** Delegate to S07 for proper AC engineering.
- **Do not guess repo names or dependency relationships.** Use F10 output or flag as open question.
- **Do not emit partial contracts without flagging missing fields.** Every gap must appear in `open_questions`.
- **Do not embed verification commands directly.** Delegate verification path design to S08.

## Denied Actions
- Do not execute code or run tests — this skill produces spec artifacts only.
- Do not modify repository files — contract output is written to the issue, not the codebase.
- Do not assign agents or trigger workflows — that is the orchestrator's responsibility.
