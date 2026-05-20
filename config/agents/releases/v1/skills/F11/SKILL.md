# F11 — Telemetry & Artifact Linker

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- Why: Без сквозной связки человек теряет наблюдаемость над системой.

## When To Use
- Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен уметь публиковать canonical URLs обратно в Linear comment/activity и собирать correlation ids.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен уметь публиковать canonical URLs обратно в Linear comment/activity и собирать correlation ids.

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
