# F07 — Risk Escalation & Human Gate

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- Why: Лучшие команды делают людей быстрее, а не выключают их.

## When To Use
- Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Возвращает reason_code, confidence, recommended next step, impact area, rollback note. Триггеры должны быть прозрачными и аудируемыми.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Возвращает reason_code, confidence, recommended next step, impact area, rollback note. Триггеры должны быть прозрачными и аудируемыми.

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
