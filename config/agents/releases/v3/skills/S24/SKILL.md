# S24 — Acceptance Matcher

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Matches the implementation result against acceptance criteria from the issue contract to produce a go/no-go recommendation.
- Why: Final verification gate before human review — ensures nothing was promised but undelivered.

## When To Use
- When implementation and testing are complete and the work needs a final acceptance check.
- When a PR is ready for human review and ReviewAgent needs to confirm spec compliance.
- When the issue contract contains explicit acceptance criteria (from S07) that must be verified.
- Do NOT use when the issue contract has no acceptance criteria defined — escalate to get them first.

## Inputs
- Issue contract: with `acceptance_criteria` field from S07, including each criterion's description and verification method.
- Diff: the complete set of changes being delivered.
- Test results: output from S20 (unit/integration) and S21 (E2E/smoke), including coverage and pass/fail.
- Review findings: output from S22 (diff review) and S23 (regression scanner), if available.

## Steps

1. **Extract acceptance criteria** — parse the issue contract and list every acceptance criterion. For each, record:
   - `id`: criterion identifier (AC-1, AC-2, etc.)
   - `description`: what must be true
   - `verification_method`: how to verify (test, manual check, code inspection, demo)
2. **Match criteria against the diff** — for each criterion:
   - Search the diff for code that implements the described behavior
   - Identify specific files, functions, and lines that satisfy the criterion
   - If the criterion requires a UI change, check for corresponding component/template changes
   - If the criterion requires an API change, check for corresponding endpoint/handler changes
3. **Match criteria against test results** — for each criterion:
   - Find tests that explicitly verify the criterion's behavior
   - Check that those tests are passing
   - If no tests exist for a criterion, flag it as `untested`
4. **Cross-reference with review findings** — check if S22 or S23 raised any issues that affect criterion satisfaction:
   - A criterion cannot be `matched` if there is a critical/high finding against its implementation
   - A criterion with a regression finding is `partially_matched` at best
5. **Classify each criterion** — assign one of:
   - `matched`: implementation exists, tests pass, no blocking review findings
   - `partially_matched`: implementation exists but is incomplete, or tests exist but some fail
   - `unmatched`: no evidence of implementation in the diff
   - `untested`: implementation exists but no tests verify it
   - `blocked`: cannot verify due to environment, tooling, or dependency issue
6. **Produce go/no-go recommendation** — based on the classification:
   - `go`: all criteria are `matched`
   - `conditional_go`: all critical criteria are `matched`, non-critical ones are `partially_matched` or `untested`
   - `no_go`: any criterion is `unmatched`, or a critical criterion is `partially_matched`
7. **Produce acceptance report** — emit structured output:
   - `criteria`: list of {id, description, status, evidence_files, evidence_tests, notes}
   - `matched_count`: number of fully matched criteria
   - `unmatched_count`: number of unmatched criteria
   - `partially_matched_count`: number of partially matched criteria
   - `untested_count`: number of untested criteria
   - `recommendation`: `go` | `conditional_go` | `no_go`
   - `summary`: 2-3 sentence explanation of the recommendation
   - `gaps`: specific list of what is missing for unmatched/partial criteria

## Stop Conditions
- **Done** when every acceptance criterion has been classified and the recommendation is emitted.
- **Done** when the acceptance report is structured with evidence for each criterion.
- **Skip** if the issue contract has no acceptance criteria — escalate to get them defined.
- **Stop early** if the diff is empty or does not touch any code related to the acceptance criteria.

## Escalation Rules
- Escalate when acceptance criteria are ambiguous and cannot be objectively matched against the diff.
- Escalate when a `no_go` recommendation involves criteria that may have been intentionally descoped.
- Escalate when the issue contract is missing or does not contain acceptance criteria.
- Do NOT escalate for `conditional_go` — present the evidence and let the human decide.
- Do NOT escalate for `untested` criteria — flag them but do not block on missing tests alone.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not invent acceptance criteria.** Only match against what the issue contract explicitly states.
- **Do not mark criteria as `matched` without evidence.** Every match must cite specific files/tests.
- **Do not be overly strict on wording.** Match intent, not literal text — "user can log in" is satisfied by a working auth flow even if the button says "Sign In".
- **Do not ignore partial implementations.** `partially_matched` is a valid and useful status.
- **Do not rubber-stamp.** If criteria are unmet, say so — this is the last gate before human review.

## Denied Actions
- Do not modify any code — this skill is read-only verification.
- Do not write or modify tests — that is S20/S21 responsibility.
- Do not change the acceptance criteria — they come from the issue contract.
- Do not issue a `go` recommendation when any criterion is `unmatched`.
