# F08 — Secrets, Permissions & Safe Command Guard

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- Why: Без этого автономия быстро превращается в безопасность на честном слове.

## When To Use
- Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужна allowlist/denylist модель по агентам и режимам (read-only, write, deploy, incident). Логировать каждую escalation и доступ к секретам. Для integration work различать docs_allowlist, sandbox_api_allowlist и release_broker_only; запрещать прямую работу с raw secrets вне broker boundary.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужна allowlist/denylist модель по агентам и режимам (read-only, write, deploy, incident). Логировать каждую escalation и доступ к секретам. Для integration work различать docs_allowlist, sandbox_api_allowlist и release_broker_only; запрещать прямую работу с raw secrets вне broker boundary.

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
