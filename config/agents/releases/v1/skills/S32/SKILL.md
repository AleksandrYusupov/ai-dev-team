# S32 — SLO/SLI & Error Budget Interpreter

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Понимает сервисные SLO/SLI, error budget policy и решает, когда нужно заморозить изменения или эскалировать reliability work.
- Why: Это зрелый operating skill, без которого monitoring формален.

## When To Use
- Понимает сервисные SLO/SLI, error budget policy и решает, когда нужно заморозить изменения или эскалировать reliability work.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Вход: SLI data, incidents, release cadence. Выход: status, budget health, allowed changes, escalation recommendation.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Вход: SLI data, incidents, release cadence. Выход: status, budget health, allowed changes, escalation recommendation.

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
