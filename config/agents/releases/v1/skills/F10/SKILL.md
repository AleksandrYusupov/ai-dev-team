# F10 — Repo/Project Registry Resolver

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- Why: У тебя это ключевой слой для multi-repo маршрутизации.

## When To Use
- Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Опирается на Repository Registry. Умеет давать confidence и объяснение маршрутизации. Поддерживает repo_kind, environments, team_id, project_id.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Опирается на Repository Registry. Умеет давать confidence и объяснение маршрутизации. Поддерживает repo_kind, environments, team_id, project_id.

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
