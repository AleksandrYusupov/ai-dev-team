# F05 — Verification Path Executor

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- Why: Отделяет «код написан» от «работа доказана».

## When To Use
- Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Поддержка приоритетов: fastest relevant tests first -> full targeted suite -> smoke. Должен логировать exact commands, outputs, artifacts and failures.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Поддержка приоритетов: fastest relevant tests first -> full targeted suite -> smoke. Должен логировать exact commands, outputs, artifacts and failures.

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
