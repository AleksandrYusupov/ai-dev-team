# S12 — Work Breakdown & Sub-Issue Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Делит работу на milestones и sub-issues по repo/component/owner.
- Why: Ядро PlanAgent.

## When To Use
- Делит работу на milestones и sub-issues по repo/component/owner.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Правила atomicity, dependency graph, parallelizable chunks, repo ownership.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Правила atomicity, dependency graph, parallelizable chunks, repo ownership.

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
