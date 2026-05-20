# S30 — Smoke Test Orchestrator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Запускает post-merge/post-deploy smoke path для ключевых сценариев.
- Why: Связывает release и monitoring.

## When To Use
- Запускает post-merge/post-deploy smoke path для ключевых сценариев.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Поддержка API/UI/checklist-based smoke, prod-safe only.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Поддержка API/UI/checklist-based smoke, prod-safe only.

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
- Do not execute protected, irreversible, or approval-bound actions without the declared human gate.
