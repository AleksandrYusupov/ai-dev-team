# S20 — Unit/Integration Test Runner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Writes and runs unit and integration tests according to the test plan from S19.
- Why: Concrete execution of the test strategy — the skill that turns plans into green (or red) test suites.

## When To Use
- When S19 has produced a test plan containing unit or integration test items.
- When a code change needs test coverage and the test types required are unit or integration.
- When existing tests are failing after a code change and need to be updated (test code only).
- Do NOT use for E2E or browser-based tests — those belong to S21.

## Inputs
- Test plan from S19: ordered list of test items with component, test_type, priority, coverage_target.
- Diff or branch: the production code changes that tests must verify.
- Existing test files: current test suite for the affected components.
- Test framework config: runner (jest, pytest, vitest, etc.), conventions, fixture patterns.

## Steps

1. **Parse the test plan** — extract all items where test_type is `unit` or `integration`. Sort by priority (highest first). Identify the test framework and conventions used in the repo.
2. **Write failing tests first** — for each test item, write the test case BEFORE verifying it passes. Follow the fail-first discipline:
   - Write the test asserting expected behavior
   - Run it — confirm it fails for the right reason (not a syntax error or import issue)
   - If it passes immediately, verify the assertion is meaningful (not a tautology)
3. **Run the test suite** — execute all new tests plus existing tests for affected components. Capture:
   - Pass/fail status per test
   - Failure messages and stack traces
   - Coverage delta (before vs after)
4. **Analyze failures** — for each failing test, determine:
   - Is it a legitimate bug in production code? (report it, do NOT fix production code)
   - Is it a test bug (wrong assertion, missing mock, bad fixture)? (fix the test)
   - Is it a flaky test (passes sometimes, fails sometimes)? (flag it and add retry logic or mark as known-flaky)
5. **Iterate on test fixes** — fix test-side issues only. Re-run after each fix. Maximum 3 iterations per test item before escalating.
6. **Measure coverage delta** — run coverage tool and compare:
   - Line coverage before and after
   - Branch coverage before and after
   - Uncovered lines that remain
7. **Produce test report** — emit structured output containing:
   - `tests_written`: count of new test cases
   - `tests_passing`: count of green tests
   - `tests_failing`: count of red tests with reasons
   - `coverage_before`: baseline coverage percentages
   - `coverage_after`: new coverage percentages
   - `coverage_delta`: improvement per component
   - `production_bugs_found`: list of suspected bugs in production code (file:line + description)
   - `known_flaky`: tests flagged as potentially flaky

## Stop Conditions
- **Done** when all test plan items have been addressed and the test report is complete.
- **Done** when coverage targets from S19 are met or the maximum achievable coverage is documented.
- **Stop early** if production code bugs block meaningful test completion — report findings and escalate.
- **Stop early** after 3 failed iterations on the same test item — flag it for human review.

## Escalation Rules
- Escalate when a test reveals a likely production bug that needs human decision on fix priority.
- Escalate when the test framework is misconfigured or missing and cannot be set up without repo-level changes.
- Escalate when coverage targets from S19 cannot be met due to untestable code patterns (global state, hidden dependencies).
- Do NOT escalate for individual test failures — iterate on fixes first.
- Do NOT escalate for low initial coverage — that is the starting point, not an error.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not modify production code.** This skill writes and fixes test code only. Production bugs are reported, not fixed.
- **Do not write tests that pass by accident.** Every test must fail first for the right reason.
- **Do not mock everything.** Integration tests should exercise real component interactions where feasible.
- **Do not ignore existing test patterns.** Match the repo's conventions for naming, structure, and fixtures.
- **Do not write trivial tests.** Testing that `1 + 1 === 2` or that a constructor sets a field adds noise, not value.

## Denied Actions
- Do not modify production source code — only test files.
- Do not delete existing passing tests without explicit justification.
- Do not disable or skip tests to make the suite green.
- Do not commit test code — that is the responsibility of the orchestrating agent.
