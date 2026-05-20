# S29 — Merge Gate Checklist

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Проверяет approvals, required checks, CODEOWNERS, deployment constraints, feature flag status, rollback note.
- Why: Нужен перед merge/deploy.

## When To Use
- Проверяет approvals, required checks, CODEOWNERS, deployment constraints, feature flag status, rollback note.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Ясный yes/no gate with missing_items.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Ясный yes/no gate with missing_items.

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
