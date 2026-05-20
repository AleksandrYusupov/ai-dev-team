# S36 — Repo Provisioning Scaffold

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Создаёт новый repo/project scaffold: CI, CODEOWNERS, branch protections, AGENTS.md/CLAUDE.md, issue templates, env skeleton.
- Why: Основа ProvisionerAgent.

## When To Use
- Создаёт новый repo/project scaffold: CI, CODEOWNERS, branch protections, AGENTS.md/CLAUDE.md, issue templates, env skeleton.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Опирается на repo_kind, template_repo, checks, environments, docs root note.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Опирается на repo_kind, template_repo, checks, environments, docs root note.

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
