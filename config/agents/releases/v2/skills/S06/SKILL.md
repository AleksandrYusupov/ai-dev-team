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
- Генерирует строгий issue contract / frontmatter из brief или комментариев.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Поля: goal, background, scope, non_goals, acceptance_criteria, verification_path, docs_links, primary_repo, affected_repos, dependencies, risk, done_when, open_questions.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Поля: goal, background, scope, non_goals, acceptance_criteria, verification_path, docs_links, primary_repo, affected_repos, dependencies, risk, done_when, open_questions.

## Stop Conditions
- TODO: define the exact completion boundary.

## Escalation Rules
- Escalate when source-of-truth inputs are missing, contradictory, or blocked by a human-owned zone.
- TODO: add skill-specific escalation thresholds.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- TODO: add skill-specific anti-patterns.

## Denied Actions
- Do not treat this skeleton metadata as runtime-ready execution logic before the later runtime-consumption blocks.
