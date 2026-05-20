# S14 — Backend Implementation Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Глубокие правила backend-кодинга: API contracts, services, validation, logging, idempotency, error handling, telemetry, feature flags.
- Why: Основной domain skill для BackendBuildAgent.

## When To Use
- When BuildAgent-Backend (A06) receives an implementation task with an approved plan and context pack for backend service changes.
- When the task involves API endpoint creation/modification, service layer logic, persistence operations, or backend validation rules.
- When code changes require enforcing idempotency, structured logging, telemetry hooks, or feature flag guards.
- Do NOT use for frontend-only changes, infrastructure/IaC work, or integration code that belongs to S16.

## Inputs
- Issue contract: task scope, type, risk classification, labels, affected areas.
- Approved plan: step-by-step implementation plan from PlanAgent with scope boundaries.
- Context pack (from F02): architecture invariants, conventions, decisions, dependencies.
- Repo guidance (from F03): language, framework, lint/test/build commands, package manager, persistence layer, code style rules.
- Existing tests and coverage baseline for affected modules.

## Steps

1. **Read spec and plan** — consume the issue contract and approved plan. Identify the exact scope of backend changes: which endpoints, services, models, and validation rules are affected. Extract acceptance criteria.
2. **Check repo conventions** — read the effective conventions from F03 output. Identify: language version, framework idioms, error handling patterns, logging format, test framework, lint rules, and build commands. Adapt all subsequent code to match.
3. **Verify API contract** — if the task involves API changes, confirm the contract (request/response schemas, status codes, headers) is defined. If missing, flag it as a blocker. Do not invent API contracts.
4. **Implement service layer** — write or modify service/domain logic following repo conventions. Keep functions focused and testable. Apply dependency injection patterns consistent with the codebase.
5. **Add validation and error handling** — implement input validation at the boundary layer. Use typed errors with classification (client error vs server error). Ensure all error paths return structured responses consistent with the API contract.
6. **Enforce idempotency** — for state-mutating operations, add idempotency guards (idempotency keys, conditional writes, upsert semantics) as appropriate. Document the idempotency strategy in code comments.
7. **Add structured logging and telemetry** — instrument new code paths with structured log entries (JSON format where the repo uses it). Add telemetry hooks (metrics, spans) at service boundaries. Follow existing telemetry patterns in the repo.
8. **Wire feature flags** — if the plan specifies feature flag gating, wrap new behavior behind the flag. Ensure the fallback path preserves existing behavior exactly.
9. **Run targeted tests** — execute unit tests for changed modules using the repo's test command. If tests fail, fix the code. Add new tests for uncovered paths introduced by this change.
10. **Update touched docs** — if code changes affect inline documentation, API docs, or module-level comments, update them to reflect the new behavior. Delegate broader doc updates to S27.
11. **Prepare diff and PR notes** — produce a clean diff with no unrelated changes. Write PR notes summarizing: what changed, why, how to test, and any follow-up items.

## Stop Conditions
- **Done** when all plan steps are implemented, targeted tests pass, lint/build succeeds, and PR notes are prepared.
- **Done** when API contract compliance is verified and all new code paths have structured logging.
- **Stop early** if the plan references modules outside the approved scope — do not implement, escalate instead.

## Escalation Rules
- Escalate when the API contract is missing or ambiguous and cannot be resolved from the spec.
- Escalate when repo conventions conflict with the plan requirements (e.g., plan demands a pattern the codebase prohibits).
- Escalate when a required dependency or service is unavailable and blocks implementation.
- Do NOT escalate for minor style questions — follow the repo's existing patterns.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not implement beyond the approved plan scope.** No scope creep, no "while I'm here" fixes.
- **Do not hardcode configuration values.** Use environment variables, config files, or feature flags.
- **Do not skip error handling.** Every new code path must have explicit error handling — no silent swallows.
- **Do not write tests that test the framework** instead of the business logic.
- **Do not mix concerns.** Keep controller/handler, service, and persistence layers separate per repo conventions.

## Denied Actions
- Do not modify infrastructure, CI/CD pipelines, or deployment configs.
- Do not introduce new dependencies without explicit plan approval.
- Do not handle raw secrets — consume only secret references provided by the runtime.
- Do not merge or push — only prepare the diff for review.
