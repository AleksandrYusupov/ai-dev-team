# S27 — Docs Synchronizer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- Why: OpenAI рекомендует встраивать docs прямо в delivery pipeline.

## When To Use
- Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Detect stale docs from diff; propose exact files to update; generate mermaid when useful. Для integration work обновлять webhook contracts, runbooks, go-live checklists и rollout notes без утечки raw-secret/auth truth.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Detect stale docs from diff; propose exact files to update; generate mermaid when useful. Для integration work обновлять webhook contracts, runbooks, go-live checklists и rollout notes без утечки raw-secret/auth truth.

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
