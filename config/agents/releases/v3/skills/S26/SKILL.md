# S26 — Supply Chain & Dependency Risk Analyzer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Оценивает обновления зависимостей, CVEs, transitive risk, semver breakage, changelog impact.
- Why: Основа DependencyAgent и SecurityAgent.

## When To Use
- Оценивает обновления зависимостей, CVEs, transitive risk, semver breakage, changelog impact.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Поддержка lockfiles, advisories, breaking changes, rollout recommendation.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Поддержка lockfiles, advisories, breaking changes, rollout recommendation.

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
