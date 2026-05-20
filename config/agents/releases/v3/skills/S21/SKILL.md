# S21 — E2E Test Runner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Writes and runs end-to-end tests, smoke tests, and browser/API-level verification for critical user flows.
- Why: E2E covers what unit and integration tests cannot — real user-facing flows across the full stack.

## When To Use
- When S19 test plan includes E2E or smoke test items for critical user flows.
- When a change affects user-facing behavior that spans multiple layers (UI -> API -> DB).
- When deployment verification requires smoke tests against a live or staging environment.
- Do NOT use for isolated logic testing — that belongs to S20 (unit/integration).

## Inputs
- Test plan from S19: items where test_type is `e2e` or `smoke`.
- Diff or branch: the production code changes that tests must verify.
- Environment config: target URL, auth credentials (from secrets), browser/API client settings.
- Existing E2E test files: current E2E suite for reference on patterns and selectors.

## Steps

1. **Identify critical user flows** — from the test plan, extract E2E and smoke items. Map each to a concrete user flow:
   - What does the user do? (navigate, click, fill form, submit)
   - What is the expected outcome? (page state, API response, data change)
   - What are the preconditions? (logged in, specific data exists)
2. **Check environment readiness** — verify the target environment is accessible:
   - Can the test runner reach the target URL?
   - Are required services healthy? (API, database, auth provider)
   - Are test fixtures or seed data available?
   - If environment is not ready, report and stop — do NOT proceed with doomed tests.
3. **Write E2E test cases** — for each flow, write the test using the repo's E2E framework (Playwright, Cypress, Selenium, or API-level tools like supertest):
   - Use stable selectors (data-testid, aria-label) over brittle ones (CSS classes, nth-child)
   - Include explicit waits for async operations — never use fixed sleep timers
   - Capture screenshots/logs at key checkpoints for failure diagnosis
4. **Run the E2E suite** — execute tests. For each test, capture:
   - Pass/fail status
   - Duration (flag tests over 30s as slow)
   - Screenshots on failure
   - Console errors and network failures
   - Retry result (run failed tests once more to detect flakiness)
5. **Detect flaky tests** — if a test fails then passes on retry (or vice versa):
   - Mark it as `flaky` in the report
   - Capture both run results for comparison
   - Identify likely cause: timing issue, race condition, environment instability
6. **Write smoke tests** — for deployment verification, write minimal tests that confirm:
   - App loads without error
   - Critical API endpoints return 200
   - Auth flow completes successfully
   - Core navigation works
7. **Produce E2E report** — emit structured output containing:
   - `tests_written`: count of new E2E/smoke test cases
   - `tests_passing`: count of green tests
   - `tests_failing`: count of red tests with failure details
   - `tests_flaky`: list of flaky tests with suspected cause
   - `screenshots`: paths to failure screenshots
   - `slow_tests`: tests exceeding 30s threshold
   - `environment_issues`: any env problems encountered

## Stop Conditions
- **Done** when all E2E/smoke items from the test plan have been addressed and the report is complete.
- **Done** when critical user flows are verified green or failures are documented with evidence.
- **Stop early** if the target environment is unreachable or unhealthy — report and escalate.
- **Stop early** if the repo has no E2E framework set up — escalate for infrastructure setup.

## Escalation Rules
- Escalate when the target environment is down or misconfigured and tests cannot run.
- Escalate when E2E failures indicate a production bug in a critical user flow.
- Escalate when flaky test rate exceeds 20% of the suite — indicates systemic environment instability.
- Do NOT escalate for individual slow tests — flag them in the report.
- Do NOT escalate for expected failures in incomplete features — mark them as known limitations.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not E2E-test everything.** Focus on critical user flows — E2E is expensive and slow.
- **Do not use fixed sleep timers.** Use explicit waits for elements, network idle, or state changes.
- **Do not use brittle selectors.** Prefer data-testid and aria attributes over CSS classes.
- **Do not ignore flaky tests.** Flakiness is a signal — detect it, report it, suggest root cause.
- **Do not modify production code.** Report bugs found during E2E; do not fix them.

## Denied Actions
- Do not modify production source code — only test files.
- Do not run tests against production environments unless explicitly authorized.
- Do not store or log auth credentials in test output or screenshots.
- Do not disable existing E2E tests to make the suite green.
