# S19 — Test Strategy Designer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Determines the optimal test mix for a task: which test types, coverage targets, and risk-based priorities.
- Why: Best teams separate "thinking about verification" into a distinct capability before writing any test code.

## When To Use
- When a new diff or feature branch needs a test plan before any test code is written.
- When existing test coverage has known gaps and the team needs a prioritized plan to close them.
- When the task involves high-risk components (auth, payments, data migrations) that require deliberate test type selection.
- Do NOT use for trivial changes (typo fixes, comment updates, config-only changes with no logic).

## Inputs
- Issue contract: task type, area, component, acceptance criteria.
- Diff or branch summary: files changed, functions added/modified/removed.
- Existing test coverage report: current coverage percentages per component, uncovered lines.
- Architecture context: component dependency graph, critical paths, integration boundaries.

## Steps

1. **Inventory the change surface** — list every file, function, and module touched by the diff. Classify each as: new code, modified code, or deleted code. Map each to its architectural layer (API, service, repository, UI, infrastructure).
2. **Assess risk per component** — for each changed component, evaluate:
   - Blast radius: how many consumers/callers depend on it
   - Complexity: cyclomatic complexity, number of branches
   - History: past bug frequency in this area (if available from issue tracker)
   - Data sensitivity: does it handle PII, auth tokens, financial data
3. **Review existing coverage** — check current test coverage for each changed component. Identify:
   - Components with zero coverage
   - Components where coverage exists but misses critical branches
   - Components where tests exist but are stale or skipped
4. **Select test types per component** — for each component, recommend one or more from:
   - Unit tests: isolated logic, pure functions, edge cases
   - Integration tests: cross-component interactions, database queries, API calls
   - E2E tests: user-facing flows that span multiple layers
   - Contract tests: API boundary verification between services
   - Smoke tests: minimal sanity checks for deployment verification
5. **Set coverage targets** — define numeric coverage targets per component based on risk:
   - Critical (auth, payments, data integrity): 90%+ line coverage
   - High (core business logic): 80%+ line coverage
   - Medium (utilities, helpers): 70%+ line coverage
   - Low (config, constants): no explicit target
6. **Prioritize by risk** — rank test items by: (risk_score * coverage_gap). Output a numbered priority list so TestAgent knows what to write first.
7. **Produce test plan** — emit structured output containing:
   - `test_items`: ordered list with component, test_type, priority, coverage_target, description
   - `estimated_test_count`: approximate number of test cases
   - `recommended_sequence`: order of execution (unit first, then integration, then e2e)
   - `known_risks`: areas where testing is limited by environment or tooling constraints

## Stop Conditions
- **Done** when every changed component has at least one test item assigned with type, priority, and coverage target.
- **Done** when the test plan is structured and ready for consumption by S20/S21.
- **Skip** if the diff contains only non-logic changes (docs, comments, formatting).
- **Stop early** if no test infrastructure exists in the repo — escalate to human for setup guidance.

## Escalation Rules
- Escalate when coverage tooling is unavailable or broken and cannot produce baseline metrics.
- Escalate when the diff touches a human-gated area (security, compliance) that requires manual test design review.
- Do NOT escalate for low coverage — that is expected input, not an error.
- Do NOT escalate for large diffs — handle them by prioritizing the highest-risk components.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not recommend E2E tests for everything.** E2E is expensive; reserve it for critical user flows.
- **Do not set 100% coverage targets.** Diminishing returns past 90% for most components.
- **Do not ignore existing tests.** Check what already exists before recommending new ones.
- **Do not produce a flat list.** Always prioritize by risk — TestAgent needs to know what matters most.

## Denied Actions
- Do not write test code — this skill produces plans only.
- Do not modify production code or test code.
- Do not run tests — that is S20/S21 responsibility.
