# R06 — Anthropic claude-api

## Summary
- Category: `reusable`
- Availability: `downloadable`
- Kind: `reusable`
- Reference-only default: `true`
- Sensitivity class: `reference_only`
- Description: Официальный пример скилла для работы с Claude API на разных языках.
- Why: Ускоряет интеграционные/SDK-задачи и обучение BuildAgent API best practices.

## When To Use
- Официальный пример скилла для работы с Claude API на разных языках.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: TBD
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: TBD

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
- Do not enable this skill as a runtime dependency until an explicit import decision is approved.
