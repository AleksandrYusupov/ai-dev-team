# F05 — Verification Path Executor

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- Why: Отделяет «код написан» от «работа доказана». Без verification path агент заявляет success без доказательств.

## When To Use
- **Mandatory** after any code change is complete — агент не может заявить "done" без прохождения verification path.
- When a task contract contains explicit `verification_path` field — выполнить все указанные шаги.
- When preparing a PR for review — прогнать verification до создания PR, приложить результаты.
- When a reviewer requests re-verification after changes — повторить полный или partial verification path.
- Do NOT use for exploratory research, spec writing, or tasks without code changes — этот скилл только для доказательства работоспособности.

## Inputs
- Task contract с полем `verification_path` (список шагов: tests, lint, smoke, coverage thresholds, security scans, manual checklists).
- Repository path и environment config (test commands, lint configs, CI pipeline reference).
- Changed files list — для определения targeted test scope.
- Previous verification results (если это re-run после фикса).
- Coverage baseline и required thresholds (если указаны в контракте).

## Steps
1. **Parse verification path** — извлечь из task contract полный список verification steps:
   - Каждый step имеет: type (test/lint/smoke/coverage/security/manual), command, expected outcome, priority.
   - Если `verification_path` отсутствует — построить default path из repo conventions (package.json scripts, Makefile targets, CI config).
   - Отсортировать по приоритету: fastest relevant first.

2. **Run targeted tests first** — начать с самых быстрых и релевантных проверок:
   - Определить тесты, непосредственно покрывающие изменённые файлы (по import graph или naming convention).
   - Выполнить команду, записать: exact command, exit code, stdout/stderr, duration.
   - Если targeted tests fail — **STOP**, записать failure details, не продолжать к full suite.

3. **Run full test suite** — если targeted tests прошли:
   - Выполнить полный test suite (или suite, указанный в verification_path).
   - Записать: total tests, passed, failed, skipped, duration.
   - Если есть flaky tests — пометить отдельно, re-run до 2 раз, записать flake pattern.

4. **Run linters and formatters** — проверить code quality:
   - Выполнить lint commands из repo config (eslint, ruff, clippy, golangci-lint и т.д.).
   - Записать: warnings count, errors count, auto-fixable count.
   - Lint errors — блокируют; warnings — записать, но не блокировать (если нет strict policy).

5. **Check coverage** — если указаны coverage thresholds:
   - Выполнить coverage collection command.
   - Сравнить с baseline: overall coverage, per-file coverage для изменённых файлов.
   - Записать: coverage delta, uncovered lines в новом коде.
   - Coverage drop ниже threshold — блокирует.

6. **Run security scans** — если указаны в verification_path:
   - Dependency audit (`npm audit`, `pip audit`, `cargo audit`).
   - Secret scanning на staged files.
   - SAST если настроен (semgrep, bandit, gosec).
   - Записать: severity levels, actionable findings.

7. **Execute smoke steps** — если указаны manual или automated smoke checks:
   - Запустить приложение/сервис локально (если возможно).
   - Выполнить smoke HTTP calls или CLI commands из checklist.
   - Записать: each step result, screenshots/logs если применимо.

8. **Compile verification report** — собрать итоговый отчёт:
   - Status: `PASS` / `FAIL` / `PARTIAL` (с указанием, что именно partial).
   - Для каждого step: command, result, duration, artifacts.
   - Общий verdict и blocker list (если FAIL).
   - Приложить report к PR description или Linear comment.

## Stop Conditions
- **Done** when all verification steps from the path have been executed and report is compiled.
- **Blocked** when any blocking step fails — зафиксировать failure, не продолжать downstream steps.
- **Partial** when non-blocking steps have warnings — записать, продолжить, пометить в report.
- **Never skip** the report compilation — даже если всё прошло, отчёт обязателен.

## Escalation Rules
- Escalate when verification path references commands or tools that are not available in the current environment.
- Escalate when flaky tests fail consistently (3+ runs) and cannot be attributed to the current changes.
- Escalate when security scan finds HIGH or CRITICAL severity issues in dependencies.
- Escalate when coverage drops significantly (>5%) and the cause is unclear.
- Do NOT escalate for routine test failures caused by the current code change — это нормальный feedback loop.

## Anti-Patterns
- **Do not skip verification and claim "done"** — "it compiles" is not verification.
- **Do not run only the fast tests and skip the rest** — full path must be executed unless contract explicitly allows partial.
- **Do not hide or minimize test failures in the report** — transparency is the point of this skill.
- **Do not auto-fix lint errors without recording what was changed** — silent auto-fixes can introduce bugs.
- **Do not treat flaky tests as "known issues" without logging them** — каждый flake должен быть записан.

## Denied Actions
- Do not modify test files to make failing tests pass (unless the test itself is the bug — and that must be explicitly documented).
- Do not disable or skip test cases to achieve green status.
- Do not fabricate or approximate verification results — every result must come from actual command execution.
- Do not delete coverage thresholds or lint rules to pass verification.
- Do not proceed to PR creation with a FAIL verdict unless explicitly approved by human.
