# S17 — Infra & IaC Builder Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Terraform/Pulumi/Kubernetes/GitHub Actions patterns: least privilege, modules, plan/apply discipline, secrets hygiene, rollback notes.
- Why: Для InfraBuildAgent.

## When To Use
- Terraform/Pulumi/Kubernetes/GitHub Actions patterns: least privilege, modules, plan/apply discipline, secrets hygiene, rollback notes.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужна интеграция с environment policies и protected deploys.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужна интеграция с environment policies и protected deploys.

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
