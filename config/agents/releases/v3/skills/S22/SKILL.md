# S22 — Diff Review

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Performs semantic diff review: logic correctness, spec compliance, performance, security basics, and code style consistency.
- Why: AI review as a high-signal baseline before human review — catches mechanical issues so humans focus on design.

## When To Use
- When a diff is ready for review and needs semantic analysis beyond linting.
- When a PR has been submitted and ReviewAgent needs to produce structured findings.
- When test results are available alongside the diff for cross-referencing coverage against changes.
- Do NOT use for reviewing test-only changes — those are validated by S19/S20/S21 output quality.

## Inputs
- Diff: unified diff or list of changed files with before/after content.
- Spec: issue contract with acceptance criteria, requirements, and constraints.
- Context pack: architecture docs, related module summaries, dependency graph.
- Test results: output from S20/S21 including coverage delta and pass/fail status.

## Steps

1. **Parse the diff** — build a structured change map: file path, hunks, added lines, removed lines, modified functions. Group changes by component/module.
2. **Check logic correctness** — for each changed function or block:
   - Trace control flow through new/modified branches
   - Verify edge cases are handled (null, empty, boundary values, overflow)
   - Check error paths: are errors caught, logged, and propagated correctly?
   - Verify loop invariants and termination conditions
   - Look for off-by-one errors, incorrect boolean logic, swapped arguments
3. **Check spec compliance** — cross-reference the diff against acceptance criteria from the issue contract:
   - Does the implementation match what was specified?
   - Are there spec items not addressed by the diff?
   - Are there changes that go beyond the spec (scope creep)?
4. **Check performance implications** — scan for:
   - N+1 query patterns (loop with DB/API call inside)
   - Unbounded collections (loading all records without pagination)
   - Missing indexes for new query patterns
   - Unnecessary re-renders or recomputations
   - Synchronous blocking in async contexts
5. **Check security basics** — scan for:
   - SQL/NoSQL injection vectors (unsanitized input in queries)
   - XSS vectors (unescaped user input in HTML/templates)
   - Auth bypass (missing authentication/authorization checks)
   - Sensitive data exposure (logging PII, returning secrets in API responses)
   - Insecure defaults (permissive CORS, disabled CSRF, hardcoded credentials)
6. **Check code style consistency** — verify:
   - Naming conventions match the repo's existing patterns
   - File organization follows project structure conventions
   - No dead code, commented-out code, or TODO-without-issue left behind
   - Import ordering and dependency patterns are consistent
7. **Rank findings by severity** — classify each finding as:
   - `critical`: will cause data loss, security breach, or crash in production
   - `high`: incorrect behavior that users will encounter
   - `medium`: performance issue, maintainability concern, or potential future bug
   - `low`: style nit, minor inconsistency, or suggestion
8. **Produce review output** — emit structured findings:
   - `findings`: list of {severity, file, line, category, description, suggested_fix, false_positive_risk}
   - `summary`: 2-3 sentence overall assessment
   - `verdict`: `approve` | `request_changes` | `needs_discussion`
   - `spec_compliance`: matched/unmatched acceptance criteria (brief, defer to S24 for full check)

## Stop Conditions
- **Done** when every changed file has been reviewed and findings are structured.
- **Done** when verdict is emitted with supporting evidence.
- **Skip** if the diff is empty or contains only whitespace/formatting changes.
- **Stop early** if the diff is too large (>2000 lines) — split into logical chunks and review sequentially.

## Escalation Rules
- Escalate when a critical security finding is detected — it needs immediate human attention.
- Escalate when the diff contradicts the spec in ways that suggest a misunderstanding of requirements.
- Escalate when the diff touches a human-gated area (compliance, legal, billing logic).
- Do NOT escalate for style nits — include them as low-severity findings.
- Do NOT escalate for large diffs — chunk and review them.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not be a rubber stamp.** If the diff is good, say so briefly — but do not invent findings to look thorough.
- **Do not produce vague findings.** Every finding must have file:line, description, and suggested fix.
- **Do not flag style issues as high severity.** Style is low; logic and security are high/critical.
- **Do not ignore the spec.** The diff must satisfy the acceptance criteria — check them.
- **Do not duplicate linter output.** Focus on semantic issues that linters cannot catch.

## Denied Actions
- Do not modify any code — this skill is read-only analysis.
- Do not approve changes that contain critical findings.
- Do not suppress findings to avoid conflict — report what you find.
