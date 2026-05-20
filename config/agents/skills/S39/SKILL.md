# S39 — Dependency Update Executor

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Автоматизирует safe dependency refresh с changelog summarization, targeted tests, rollout note и rollback plan.
- Why: Для DependencyAgent.

## When To Use
- Автоматизирует safe dependency refresh с changelog summarization, targeted tests, rollout note и rollback plan.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Batching policy, critical CVE fast lane, low-risk grouped updates.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Batching policy, critical CVE fast lane, low-risk grouped updates.

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
