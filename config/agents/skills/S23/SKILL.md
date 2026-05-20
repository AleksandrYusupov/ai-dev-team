# S23 — Regression Scanner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Scans a diff for regressions: broken contracts, removed validations, weakened error handling, and behavioral changes without corresponding test updates.
- Why: Regressions are the most frequent source of production incidents — a dedicated scanner catches what general review misses.

## When To Use
- When a diff modifies existing code (not purely additive) and needs regression analysis.
- When the change touches shared utilities, APIs, or contracts that have downstream consumers.
- When a refactoring or migration PR needs verification that behavior is preserved.
- Do NOT use for brand-new code with no existing consumers — there is nothing to regress against.

## Inputs
- Diff: unified diff with before/after content for all changed files.
- Dependency graph: callers and consumers of changed functions/modules/APIs.
- Existing test suite: current tests covering the changed code, including their pass/fail status.
- API contracts: OpenAPI specs, GraphQL schemas, or typed interfaces for changed boundaries.

## Steps

1. **Identify removed or weakened code** — scan the diff for:
   - Removed validation checks (input validation, auth guards, null checks)
   - Weakened error handling (catch blocks made broader, errors swallowed, fallbacks removed)
   - Removed or relaxed type constraints (any casts, loosened generics, removed required fields)
   - Deleted assertions or invariant checks
2. **Check API contract changes** — for every changed public interface, endpoint, or exported function:
   - Has the signature changed? (added/removed params, changed types, changed return type)
   - Has the behavior changed for existing inputs? (different output for same input)
   - Has an optional field become required or vice versa?
   - Has an enum gained or lost values?
   - Cross-reference with API specs (OpenAPI, GraphQL schema) if available
3. **Map consumer impact** — for each contract change found:
   - List all known callers/consumers of the changed interface
   - Determine if consumers handle the new behavior correctly
   - Flag consumers that were not updated alongside the contract change
4. **Check for removed tests** — scan the diff for:
   - Deleted test files or test cases
   - Tests changed from `it()` to `it.skip()` or `xit()`
   - Reduced assertion count within existing tests
   - Tests that no longer cover the modified behavior
5. **Check behavioral consistency** — for modified functions:
   - Compare input/output behavior before and after the change
   - Look for changed default values, different sorting orders, altered formatting
   - Verify that error messages and error codes are preserved
   - Check that logging and observability hooks are still in place
6. **Check dependency changes** — scan for:
   - Dependency version downgrades (not just upgrades)
   - Removed dependencies that other code still imports
   - Changed dependency configuration (connection strings, timeouts, retry policies)
7. **Produce regression report** — emit structured output:
   - `regressions_found`: list of {severity, type, file, line, description, affected_consumers, evidence}
   - `removed_validations`: count and details
   - `contract_changes`: list of changed interfaces with consumer impact
   - `removed_tests`: list of deleted or disabled tests
   - `verdict`: `no_regressions` | `regressions_found` | `potential_regressions_need_review`

## Stop Conditions
- **Done** when every modification (not addition) in the diff has been scanned for regression patterns.
- **Done** when consumer impact has been mapped for all contract changes.
- **Skip** if the diff is purely additive (new files, new functions with no changes to existing code).
- **Stop early** if the dependency graph is unavailable — report findings without consumer impact mapping and note the limitation.

## Escalation Rules
- Escalate when a removed validation or weakened error handling affects a security-critical path.
- Escalate when an API contract change has no corresponding update to known consumers.
- Escalate when tests were removed without replacement and the changed code is high-risk.
- Do NOT escalate for intentional behavioral changes that are documented in the issue contract.
- Do NOT escalate for test refactoring that preserves coverage.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not flag all removals as regressions.** Intentional cleanup of dead code is valid — check if the removed code had active consumers.
- **Do not ignore transitive consumers.** A changed utility may affect modules that do not directly import it.
- **Do not skip dependency changes.** Version downgrades and config changes are common regression sources.
- **Do not treat added code as regression.** Focus on modifications and deletions of existing behavior.
- **Do not produce findings without evidence.** Every regression must cite the specific before/after diff.

## Denied Actions
- Do not modify any code — this skill is read-only analysis.
- Do not revert changes — report findings for human decision.
- Do not approve changes that contain unaddressed regressions in critical paths.
