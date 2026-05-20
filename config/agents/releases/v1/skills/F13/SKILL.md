# F13 — Sensitive Auth Data Boundary Guard

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- Why: Это отдельный boundary-control слой: внешняя интеграция не должна превращать planning/orchestration/docs в хранилище credentials.

## When To Use
- Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужен classifier чувствительных полей + redaction/deny-write pipeline по местам записи. Входы: comments, callback payloads, artifacts, docs, db writes. Выходы: sanitized payload, denied_write event, safe summary, audit trail. Должен различать 'можно хранить metadata' vs 'нельзя хранить raw auth truth'.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужен classifier чувствительных полей + redaction/deny-write pipeline по местам записи. Входы: comments, callback payloads, artifacts, docs, db writes. Выходы: sanitized payload, denied_write event, safe summary, audit trail. Должен различать 'можно хранить metadata' vs 'нельзя хранить raw auth truth'.

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
