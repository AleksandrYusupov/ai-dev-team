# F07 — Risk Escalation & Human Gate

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- Why: Лучшие команды делают людей быстрее, а не выключают их.

## When To Use
- When any agent encounters a trigger domain: security changes, payment logic, auth/credential flows, database migrations, destructive operations, or ambiguous scope.
- When agent confidence on a decision drops below the defined threshold and autonomous action would be risky.
- When the workflow reaches a named human gate: `product_intent`, `architecture_sign_off`, `final_review_merge`, `protected_deploy`, `credential_ownership_vendor_console_actions`.
- When a rollback would be difficult or impossible if the autonomous action turns out to be wrong.
- Do NOT use for routine low-risk operations where the agent has high confidence and the domain is not in the trigger list.

## Inputs
- Trigger source — описание действия или решения, которое вызвало проверку: agent_id, action_type, target (file, service, environment).
- Domain classification — одна из категорий: `security`, `payments`, `auth`, `migration`, `destructive_ops`, `ambiguous_scope`, `low_confidence`, `named_gate`.
- Agent confidence — числовое значение 0.0–1.0, текущая уверенность агента в правильности предполагаемого действия.
- Impact area — что затронуто: список сервисов, repos, environments, user-facing surfaces.
- Context snapshot — краткое описание текущего состояния: что уже сделано, что планировалось дальше, какие альтернативы рассматривались.
- Gate name (optional) — если это named human gate, указать конкретное имя из списка: `product_intent`, `architecture_sign_off`, `final_review_merge`, `protected_deploy`, `credential_ownership_vendor_console_actions`.

## Steps
1. **Classify the trigger** — определить domain classification по action_type и target. Проверить явные trigger lists: (a) security — любые изменения в auth, permissions, RBAC, encryption, secret rotation; (b) payments — billing, pricing, payment processing, subscription logic; (c) auth — OAuth flows, credential storage, session management, API key generation; (d) migration — database schema changes, data migrations, state transformations; (e) destructive_ops — delete, drop, truncate, force-push, environment teardown; (f) ambiguous_scope — conflicting requirements, undefined acceptance criteria, confidence < 0.5; (g) named_gate — workflow достиг checkpoint из списка human gates.
2. **Evaluate confidence threshold** — сравнить agent confidence с порогами: security/payments/auth domains = порог 0.95 (почти любое сомнение — эскалация); migration/destructive_ops = порог 0.9; ambiguous_scope = порог 0.7; named_gate = всегда эскалация независимо от confidence. Если confidence >= порог и domain не named_gate — записать audit log и разрешить продолжение.
3. **Assess reversibility** — определить rollback complexity: `trivial` (git revert, feature flag off), `moderate` (migration rollback script exists), `hard` (data loss possible, external side effects), `irreversible` (production payments, sent emails, deleted data). Если reversibility = hard/irreversible, понизить effective confidence на 0.2.
4. **Generate reason_code** — сформировать machine-readable reason_code в формате `{domain}_{specific_trigger}`, например: `security_rbac_change`, `payments_pricing_update`, `auth_oauth_flow_modification`, `migration_schema_alter`, `destructive_drop_table`, `gate_architecture_sign_off`. Reason code должен быть уникальным и grep-friendly.
5. **Compose escalation payload** — собрать структурированный ответ: `{reason_code, confidence, domain, impact_area, recommended_next_step, rollback_note, reversibility, context_summary, gate_name, timestamp, agent_id}`. Recommended_next_step — конкретное действие для человека: "Review RBAC policy change in file X", "Approve pricing table migration", "Sign off architecture decision for service Y".
6. **Determine routing** — по gate_name или domain определить, кому маршрутизировать: product_intent -> Product Owner; architecture_sign_off -> Tech Lead; final_review_merge -> Senior Developer; protected_deploy -> DevOps/SRE; credential_ownership_vendor_console_actions -> Security Lead. Если routing неоднозначен — включить в payload `routing_uncertain: true`.
7. **Write audit record** — записать полный audit trail: trigger source, classification, confidence, decision (escalated/passed), reason_code, timestamp. Audit record должен быть immutable и доступен для post-incident review.
8. **Halt autonomous execution** — если решение = escalate, остановить текущий agent workflow, вернуть escalation payload вызывающему агенту, установить issue status в waiting_for_human. Агент НЕ продолжает работу до получения human response.

## Stop Conditions
- **Done (pass-through)** when trigger is classified, confidence exceeds threshold for the domain, reversibility is trivial/moderate, and audit record is written — agent may continue autonomously.
- **Done (escalated)** when escalation payload is assembled, audit record is written, and workflow is halted pending human decision.
- **Stop early** if trigger source or domain classification cannot be determined — escalate with reason_code `unclassified_risk` and confidence = 0.0.

## Escalation Rules
- Always escalate for named human gates — no exceptions, no confidence override.
- Always escalate when reversibility = `irreversible`, regardless of confidence score.
- Escalate when domain is security/payments/auth and confidence < 0.95.
- Escalate when domain is migration/destructive_ops and confidence < 0.9.
- Escalate when multiple trigger domains apply simultaneously (e.g., auth + migration).
- Do NOT escalate for read-only operations, even in sensitive domains.
- Do NOT suppress escalation based on deadline pressure or agent workload.

## Anti-Patterns
- **Do not auto-approve by inflating confidence.** Confidence должна отражать реальную уверенность агента, а не желание продолжить работу.
- **Do not batch multiple escalations into one.** Каждый trigger — отдельный escalation payload с отдельным reason_code и audit record.
- **Do not skip audit logging for pass-through decisions.** Даже если агент продолжает автономно, audit record обязателен.
- **Do not treat named gates as optional.** Gates из списка — mandatory checkpoints; агент не имеет права их обходить.
- **Do not provide vague recommended_next_step.** "Please review" — не actionable. Указать конкретный файл, изменение, решение.

## Denied Actions
- Do not execute the risky action autonomously after identifying an escalation trigger.
- Do not modify escalation thresholds at runtime — thresholds are policy, not agent decisions.
- Do not delete or modify audit records.
- Do not impersonate human approval or forge gate sign-off.
- Do not downgrade domain classification to avoid escalation.
- Do not continue workflow execution while in `waiting_for_human` state.
