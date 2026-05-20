# S08 — Verification Path Designer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Строит конкретный technical proof path: commands, checks, smoke, manual steps, expected outputs.
- Why: Связывает spec и test.

## When To Use
- When an issue contract has acceptance criteria (from S07) but no concrete verification steps that F05 can execute.
- When S06 (Issue Contract Generator) needs a `verification_path` field populated with executable proof steps.
- When a completed task needs a runnable check sequence before it can be marked as done.
- Do NOT use when verification steps already exist and have been validated — use F05 (Verification Path Executor) to run them directly.

## Inputs
- Acceptance criteria set (from S07 output — tier-classified, with verification method hints).
- Issue contract (from S06 / F01 — provides primary_repo, affected_repos, scope, risk level).
- Repo test commands and infrastructure (from AGENTS.md repo guidance — test runners, lint commands, build commands, environment setup).
- Environment constraints (from project profile — available CI environments, secrets access, staging URLs).

## Steps

1. **Inventory available verification tools** — from the repo guidance in AGENTS.md, collect: test runner commands (e.g., `pytest`, `npm test`, `go test`), lint/format commands, build commands, migration commands, and any repo-specific smoke test scripts.
2. **Map each AC to a verification step** — for every acceptance criterion from S07, design a concrete step. Each step must include:
   - `step_id`: sequential identifier (e.g., `v01`, `v02`)
   - `ac_ref`: which acceptance criterion this verifies
   - `type`: one of `unit_test`, `integration_test`, `smoke_test`, `lint_check`, `build_check`, `manual_verification`, `monitoring_query`
   - `command`: the exact shell command or action to run
   - `expected_output`: what success looks like (exit code 0, specific string in output, HTTP status)
   - `failure_action`: what to do if this step fails (block, warn, retry with flag)
3. **Order by fastest signal** — sort verification steps by speed of feedback:
   - First: lint and type checks (seconds)
   - Second: unit tests targeting changed modules (seconds to minutes)
   - Third: targeted integration tests (minutes)
   - Fourth: smoke tests and end-to-end checks (minutes)
   - Last: manual verification and monitoring queries (requires human)
4. **Add environment setup preamble** — if steps require specific setup (database migrations, env vars, service startup), prepend setup commands as prerequisite steps with type `setup`. Include teardown steps at the end if resources were provisioned.
5. **Handle cross-repo verification** — if `affected_repos` lists multiple repos, design steps that verify each repo independently first, then verify integration points between them. Note which repo each step targets.
6. **Mark blocking vs. advisory steps** — classify each step:
   - `blocking`: failure means the task is not done (e.g., unit tests fail)
   - `advisory`: failure is a warning but does not block completion (e.g., optional performance benchmark)
7. **Add manual verification fallback** — for any AC that cannot be fully verified by automated commands (e.g., UI appearance, UX flow), add a `manual_verification` step with: what to check, where to check it, and what the expected state is.
8. **Emit verification path** — output the ordered step list as a structured block compatible with the issue contract `verification_path` field and consumable by F05 (Verification Path Executor).

## Stop Conditions
- **Done** when every acceptance criterion has at least one verification step mapped to it.
- **Done** when the step list is ordered by fastest signal and each step has command, expected_output, and failure_action.
- **Stop early** if no test infrastructure exists in the repo — escalate with a recommendation to set up minimal test tooling.
- **Stop early** if acceptance criteria are missing or too vague to design verification steps — bounce back to S07.

## Escalation Rules
- Escalate when the repo has no test runner, no lint config, and no build command — verification path cannot be constructed without basic tooling.
- Escalate when verification requires access to production systems or secrets that the agent team cannot reach.
- Escalate when cross-repo integration tests require coordinated deployment that exceeds the agent team's authority.
- Do NOT escalate for missing optional monitoring queries on low-risk tasks — note the gap and mark as advisory.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not write abstract verification steps.** "Run tests" is not a step. Specify the exact command: `cd backend && pytest tests/unit/test_auth.py -v`.
- **Do not skip the ordering rule.** Fastest signal first is not optional — it prevents wasted CI minutes and slow feedback loops.
- **Do not assume environment state.** Every step must either declare its prerequisites or include setup commands.
- **Do not design steps that modify production data.** Verification is read-only against production; write operations go to staging or test environments only.
- **Do not generate steps for AC that does not exist.** The step list must trace back to S07 output — no phantom verifications.

## Denied Actions
- Do not execute the verification steps — this skill designs the path; F05 executes it.
- Do not modify test files or test infrastructure — that is the build agent's responsibility.
- Do not deploy code to any environment — verification path design is a spec activity, not an execution activity.
