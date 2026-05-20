# F08 — Secrets, Permissions & Safe Command Guard

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- Why: Без этого автономия быстро превращается в безопасность на честном слове. Каждое действие агента должно проходить через permission boundary.

## When To Use
- **Mandatory** before any command execution, secret access, or environment interaction — этот скилл работает как gate, а не как post-check.
- When an agent needs to access API tokens, credentials, or environment variables — проверить через allowlist и broker boundary.
- When an agent attempts to run shell commands, MCP tools, or access file paths outside its sandbox — валидировать против policy.
- When switching between operation modes (read-only -> write -> deploy -> incident) — переключить permission set.
- Do NOT use for pure in-memory computation, prompt construction, or text generation — этот скилл только для actions с side effects.

## Inputs
- Agent identity: agent_id, role, current operation mode (read-only / write / deploy / incident).
- Requested action: command string, tool name, file path, secret key, environment target.
- Policy config: allowlist/denylist per agent role and mode.
  - `docs_allowlist` — разрешённые documentation и read-only endpoints.
  - `sandbox_api_allowlist` — разрешённые sandbox/staging API calls.
  - `release_broker_only` — actions, доступные только через release broker.
- Broker boundary config: какие secrets доступны напрямую vs. через broker.
- Audit log destination (для записи каждого access event).

## Steps
1. **Identify agent and mode** — определить, кто запрашивает и в каком режиме:
   - Извлечь agent_id, role из session context.
   - Определить текущий operation mode: `read-only`, `write`, `deploy`, `incident`.
   - Загрузить соответствующий permission set из policy config.

2. **Classify the requested action** — категоризировать запрос:
   - `command_execution` — shell command, script, build tool.
   - `secret_access` — запрос токена, API key, credential.
   - `file_access` — чтение/запись файла вне разрешённых путей.
   - `tool_invocation` — MCP tool call, external service call.
   - `environment_interaction` — deploy, restart, scale, database migration.
   - `network_call` — HTTP request к external endpoint.

3. **Check against allowlist/denylist** — для каждой категории применить правила:
   - Если action в denylist — **DENY** немедленно, записать в audit log, вернуть reason.
   - Если action в allowlist — **ALLOW**, записать в audit log.
   - Если action не в обоих списках — **DENY by default**, эскалировать для review.
   - Для integration work проверить специфичные списки:
     - `docs_allowlist`: GET requests к documentation endpoints.
     - `sandbox_api_allowlist`: API calls только к sandbox/staging environments.
     - `release_broker_only`: deploy/publish actions только через broker.

4. **Enforce broker boundary for secrets** — секреты не должны попадать к агенту напрямую:
   - Агент запрашивает secret по key name, не по value.
   - Broker возвращает scoped token с ограниченным TTL и scope.
   - Raw secret values никогда не передаются в agent context, prompt, или log.
   - Если агент пытается получить raw secret — **DENY**, записать violation.

5. **Validate command safety** — для shell commands дополнительная проверка:
   - Запрещённые patterns: `rm -rf /`, `DROP DATABASE`, `chmod 777`, `curl | sh`, `eval`, destructive git operations.
   - Запрещённые targets: production databases, main branches (без approval), external services (без allowlist).
   - Redirect и pipe chains — разбирать каждую команду в chain отдельно.
   - Timeout enforcement: каждая команда должна иметь max execution time.

6. **Log every access event** — каждое решение (ALLOW/DENY) записывается:
   - Timestamp, agent_id, action_type, action_detail, decision, reason.
   - Для secret access: key name (НЕ value), scope, TTL granted.
   - Для denied actions: violation_type, recommended_alternative.
   - Audit log immutable — агент не может редактировать свои прошлые записи.

7. **Mode transition validation** — при переключении режима:
   - `read-only -> write`: разрешено для BuildAgents с active task.
   - `write -> deploy`: только через ReleaseAgent, с human approval gate.
   - `any -> incident`: разрешено для MonitorAgent, расширяет read access, не расширяет write.
   - Каждая transition записывается в audit log с reason.

## Stop Conditions
- **Done** when the action has been allowed or denied and the decision is logged.
- **Blocked** when action requires mode escalation that is not available — deny and escalate to human.
- **Never skip** the audit log — даже для allowed actions запись обязательна.

## Escalation Rules
- Escalate when an agent requests an action not in allowlist or denylist (unknown action pattern).
- Escalate when an agent needs production access and current mode does not permit it.
- Escalate when repeated DENY events from the same agent suggest misconfigured permissions or agent drift.
- Escalate when a secret access pattern looks anomalous (unusual key, unusual frequency, unusual agent).
- Do NOT escalate for routine allowed actions — каждый ALLOW не требует human review.

## Anti-Patterns
- **Do not use "allow all" mode** — даже в development, permissions should be explicit.
- **Do not pass raw secrets through agent context or prompts** — only key names and broker-scoped tokens.
- **Do not treat denylist as exhaustive** — default is DENY; allowlist is the source of truth.
- **Do not log secret values in audit trail** — log key names, access patterns, never values.
- **Do not allow "just this once" exceptions without recording them** — every exception becomes a precedent.

## Denied Actions
- Do not expose raw secret values (API keys, tokens, passwords) to agent prompt, context, or output.
- Do not execute commands on production systems without explicit human approval gate.
- Do not modify permission policies at runtime — policy changes require human review.
- Do not disable audit logging for any reason, including performance.
- Do not allow an agent to escalate its own permissions without human confirmation.
- Do not allow direct database access in deploy or incident mode without broker mediation.
