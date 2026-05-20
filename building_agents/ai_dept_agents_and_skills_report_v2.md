# AI-отдел разработки: рекомендованная карта агентов и скиллов (v1.1)

Этот документ адаптирован под схему `Linear + orchestration layer + GitHub + Obsidian + Secrets/Auth plane`, которую ты уже описал. Он не копирует оргчарт людей 1:1, а переводит лучшие практики сильных инженерных организаций в **capability-based agent architecture**.

Версия `v1.1` явно учитывает твой текущий `IntegrationAgent` и отдельный `Secrets/Auth plane`: теперь это не факультативный комментарий к BuildAgent-Integrations, а самостоятельная control-plane capability со своими артефактами, правилами readiness и библиотекой скиллов.

## 1) Главный вывод

- Не надо создавать агент-клоны каждой человеческой должности. **Не нужны** автономные `ScrumMasterAgent`, `EngineeringManagerAgent` или `CTOAgent`.
- Надо создавать агентные роли вокруг **артефактов и repeatable workflows**: triage, context, spec, ADR, plan, integration onboarding/auth, build, test, review, security, release, monitoring, docs, provisioning, maintenance, evals.
- В Linear должен быть **один основной видимый orchestration agent** (`@dept` / `@orchestrator`) и, опционально позже, отдельный `@review`. Остальные — внутренние логические роли.
- Человек остаётся владельцем intent, architecture sign-off, final code review/merge, protected deployment decisions и любых действий вокруг production credentials / vendor console.
- **Новая важная развилка:** `IntegrationAgent` != `BuildAgent-Integrations`. Первый отвечает за auth/onboarding/readiness/go-live boundary; второй — за конкретный integration code внутри уже безопасно определённых рамок.

## 2) Как сейчас устроены лучшие инженерные команды

Лучшие команды сегодня строятся вокруг нескольких одновременно работающих принципов:

1. **Stream-aligned delivery** — маленькие команды/потоки, отвечающие за конкретную ценность для пользователя.
2. **Platform enablement** — отдельный слой, который снимает инфраструктурную и tooling-сложность с delivery-команд.
3. **Embedded reliability/security thinking** — качество, безопасность и наблюдаемость не выносятся «куда-то потом».
4. **Spec/plan-driven execution** — прежде чем делегировать агенту длинную задачу, команда фиксирует контракт, план, валидации и границы.
5. **Human-in-the-loop gates** — самые сильные сетапы не убирают человека из high-risk decision points, а делают человека быстрее.
6. **Sensitive-state separation** — secrets/token/auth truth живёт в отдельной plane/broker boundary; комментарии, docs и prompt bundles видят только sanitized metadata.

Для твоей схемы это означает, что вокруг внешних интеграций нужно выделять не только кодовый профиль, но и отдельную **integration control-plane capability**: классификация auth-схемы, credential prerequisite handshake, readiness gating, webhook hardening, sandbox validation и go-live checklist.

## 3) Какие человеческие роли нельзя полностью заменять агентами

### Product owner / founder

- Держать человеком: **yes**
- Почему: Отвечает за intent, priority, trade-offs и final business choice.
- Как помогают агенты: IntakeAgent, SpecAgent, ReporterAgent могут подготавливать варианты, но не владеть intent.

### Engineering lead / manager

- Держать человеком: **yes**
- Почему: Нужен для ownership, staffing, conflict resolution, standards, hiring, coaching, escalation.
- Как помогают агенты: EvalsAgent, ReporterAgent и OrchestratorAgent дают данные и варианты, но не заменяют accountable owner.

### Final code owner / reviewer

- Держать человеком: **yes**
- Почему: GitHub branch protection, CODEOWNERS и safe delivery best practices предполагают независимый human review.
- Как помогают агенты: ReviewAgent и SecurityAgent делают baseline review до человека.

### Deployment approver / reliability owner

- Держать человеком: **yes**
- Почему: Protected environments, high-risk releases, error budget policy и incident judgment должны оставаться human-led.
- Как помогают агенты: ReleaseAgent и MonitoringAgent сокращают toil и ускоряют диагностику.

### Credential owner / integration approver

- Держать человеком: **yes**
- Почему: Продовые credentials, redirect URI registration, scope approval, browser-based consent и vendor console actions — это точки ответственности и риска, которые нельзя полностью отдавать автономии.
- Как помогают агенты: IntegrationAgent готовит credential requests, validation reports, auth decision records и go-live checklists; SecurityAgent проверяет posture.

## 4) Итоговый список агентов

> Ниже — **полный рекомендуемый набор**. Для MVP можно стартовать с core-агентов первой волны. С учётом твоего текущего проекта `IntegrationAgent` теперь входит в ядро, а не живёт скрытым допущением внутри Build-профиля.

### A00 — OrchestratorAgent

- **Уровень:** core
- **Видим в Linear:** yes (единственный основной app user, опционально плюс @review позже)
- **Миссия:** Управляет state machine issue, запускает/останавливает специализированных агентов, следит за human gates, publishes high-signal status back to Linear.
- **Почему нужен:** Это не просто dispatcher. Это control-plane лицо всей системы.
- **Ответственность:**
  - Следить за allowed status transitions и запускать правильный workflow на каждом этапе
  - Выбирать нужного внутреннего агента/подагента по type, risk, repo, status
  - Публиковать summaries, blockers, next actions и links на артефакты
  - Уважать human gates на review/merge/deploy и high-risk work
  - Эскалировать при low confidence, external blocker, policy violation
  - Не переводить integration-heavy issue в Ready for Build, пока не закрыты credential prerequisites, consent steps и runner capability requirements.
  - Различать Needs Input vs Blocked для integration-задач: человек/consent/console action против vendor/sandbox/broker outage.
- **Входы:** Issue contract, status change, comment/@ask signal, PR/CI/deploy events, registry and policy data
- **Выходы:** state transitions, agent assignments, Linear comments, externalUrls, escalations, reason codes
- **Human gate:** Да — всегда уважает Needs Input / Needs Human Decision / protected environments.
- **Метрики:** cycle time by status, stuck issue rate, rework loop rate, handoff latency, summary quality
- **Пакет скиллов:** F01, F02, F03, F06, F07, F08, F09, F10, F11, F13, S01, S03, S43, S44, S48, S52, S53

### A01 — IntakeAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Нормализует новый вход: типизирует задачу, проверяет полноту, ищет дубликаты, определяет маршрут.
- **Почему нужен:** Сильный triage экономит большую часть последующего шума.
- **Ответственность:**
  - Classify type/risk/source/mode
  - Detect duplicates and near-duplicates
  - Identify missing input
  - Suggest primary repo and next status
  - Выявлять, что задача требует IntegrationAgent: external API, service-to-service или webhook.
- **Входы:** new issue, reopened issue, monitoring bug, user comments
- **Выходы:** triage classification, next-status recommendation, duplicate candidates, clarifying question draft
- **Human gate:** Только при ambiguous scope/high-risk/low-confidence routing.
- **Метрики:** triage accuracy, duplicate catch rate, needs-input precision, routing accuracy
- **Пакет скиллов:** F01, F02, F09, F10, F13, S01, S02, S03, S46

### A02 — ContextAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Собирает authoritative context pack для остальных агентов.
- **Почему нужен:** Контекст — главный мультипликатор качества в агентной разработке.
- **Ответственность:**
  - Pull repo guidance
  - Retrieve docs/ADR/runbooks
  - Summarize comment history
  - Resolve repo/project/service dependencies
  - Resolve sanitized integration artifact references without exposing auth truth.
- **Входы:** issue contract, docs links, registry, repo metadata, comment log
- **Выходы:** context pack, decision summary, authoritative links, known unknowns
- **Human gate:** Нет, кроме missing source-of-truth conflicts.
- **Метрики:** context relevance, missing-context incident rate, token efficiency
- **Пакет скиллов:** F02, F03, F09, F10, F11, F13, S04, S05

### A03 — SpecAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Превращает brief в исполнимый контракт задачи.
- **Почему нужен:** AI-first delivery лучше всего работает на well-specified work.
- **Ответственность:**
  - Generate issue contract
  - Separate scope/non-goals
  - Engineer acceptance criteria
  - Design verification path
  - Create SPEC draft when needed
- **Входы:** brief, comments, context pack, existing docs
- **Выходы:** issue contract, SPEC.md, open questions, risk notes, integration extension fields when the task touches external systems
- **Human gate:** Да, если остаются продуктовые или риск-решения.
- **Метрики:** spec completeness, build rework caused by spec gaps, clarification count
- **Пакет скиллов:** F01, F02, F06, F07, F13, R01, R07, S06, S07, S08

### A04 — ArchitectAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Готовит архитектурные решения и ADR для risky/cross-cutting work.
- **Почему нужен:** Нужен отдельный слой между spec и implementation для auth/payments/migrations/cross-repo redesign.
- **Ответственность:**
  - Option matrix
  - Cross-repo impact analysis
  - Migration design
  - Rollout/rollback architecture
  - ADR authoring
  - Design auth/onboarding boundaries for high-risk integrations when needed.
- **Входы:** spec, context pack, repo architecture, dependency graph
- **Выходы:** ADR.md, option matrix, impact map, recommended decision
- **Human gate:** Да — архитектурный выбор и high-risk sign-off.
- **Метрики:** architectural rework rate, incidents from design flaws, decision turnaround time
- **Пакет скиллов:** F02, F06, F07, F10, F13, R01, S09, S10, S11

### A05 — PlanAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Декомпозирует контракт на milestones/sub-issues и execution plan.
- **Почему нужен:** План нужен для long-horizon autonomy и безопасного параллелизма.
- **Ответственность:**
  - Sub-issue generation
  - Dependency sequencing
  - Plan.md generation
  - Execution-ready checklist
  - Sequence integration prerequisites before implementation and release work.
- **Входы:** issue contract, ADR, registry, context pack
- **Выходы:** PLAN.md, sub-issues, dependency graph, build-ready recommendation
- **Human gate:** Да, если план меняет scope/ownership or creates large risky decomposition.
- **Метрики:** plan accuracy, blocked work due to bad sequencing, sub-issue completion rate
- **Пакет скиллов:** F01, F06, F10, F13, R01, S12, S13

### A21 — IntegrationAgent

- **Уровень:** core
- **Видим в Linear:** no (internal orchestration role, not separate Linear assignee)
- **Миссия:** Ведёт внешний integration lifecycle как отдельный readiness/auth/onboarding/control-plane поток: классифицирует integration kind и auth scheme, готовит sanitized integration artifacts, держит build-loop вне Ready for Build до закрытия prerequisites и доводит интеграцию до go-live boundary.
- **Почему нужен:** Внешние интеграции ломаются не только кодом, но и неверной auth-моделью, отсутствующим consent, плохим webhook hardening, sandbox drift и утечкой секретов. Поэтому одного BuildAgent-Integrations недостаточно.
- **Ответственность:**
  - Classify provider, integration_kind and auth_scheme
  - Produce integration_brief and auth_decision_record
  - Extend/validate issue contract fields for provider, scopes, redirect URIs, callback URLs, test strategy, go-live checklist and rollback plan
  - Request credential prerequisites through structured Needs Input without asking for raw credential paste
  - Work against metadata-only Secrets/Auth plane: secret slots, client registrations, consent state, token-handle metadata, webhook registrations, validation runs
  - Validate sandbox/onboarding state and runner/network capability fit
  - Drive adapter implementation, webhook hardening, observability and rollout checklists together with BuildAgent-Integrations, SecurityAgent, ReleaseAgent and MonitoringAgent
- **Входы:** issue contract, vendor docs, existing client registrations and webhook facts, sandbox/consent status, runner capability manifests, security and release policy
- **Выходы:** integration_brief, auth_decision_record, credential_request, credential_validation_report, oauth_consent_session, webhook_contract, webhook_validation_report, integration_smoke_report, integration_go_live_checklist
- **Human gate:** Да — browser-based consent, production credential use, redirect URI registration, scope approval, vendor console actions и final go-live decisions остаются human-approved.
- **Метрики:** time-to-integration-readiness, credential prerequisite loop time, webhook verification pass rate, integration readiness accuracy, secrets policy violations prevented, go-live regression rate
- **Пакет скиллов:** F01, F02, F03, F06, F07, F08, F10, F11, F13, S46, S47, S48, S49, S50, S51, S52, S53, S54

### A06 — BuildAgent-Backend

- **Уровень:** core
- **Видим в Linear:** no (internal profile/subagent)
- **Миссия:** Реализует backend code changes в пределах узкого плана и repo conventions.
- **Почему нужен:** Основной coding worker для API/services/business logic.
- **Ответственность:**
  - Implement scoped code changes
  - Run targeted tests
  - Update docs touched by code
  - Prepare diff/PR notes
- **Входы:** plan/spec, context pack, repo guidance, existing code
- **Выходы:** commits/diff, test outputs, updated docs, PR draft
- **Human gate:** Нужен на final review/merge; эскалация при ambiguity or architecture drift.
- **Метрики:** first-pass pass rate, scoped diff discipline, escaped defects, rework from overreach
- **Пакет скиллов:** F03, F04, F05, F06, F07, F08, F13, R10, S14, S27

### A07 — BuildAgent-Frontend

- **Уровень:** core
- **Видим в Linear:** no (internal profile/subagent)
- **Миссия:** Реализует UI/UX/code changes с соблюдением design system, a11y и state flows.
- **Почему нужен:** Frontend work имеет свой набор рисков и нуждается в отдельном skill pack.
- **Ответственность:**
  - Build components/pages
  - Respect loading/error/empty states
  - Add analytics/a11y hooks
  - Update docs/screenshots if required
- **Входы:** spec, design guidance, frontend codebase
- **Выходы:** UI diff, component tests, updated stories/docs
- **Human gate:** Нужен на UX-sensitive or public-facing final review.
- **Метрики:** UI defect escape rate, a11y compliance, visual regression rate
- **Пакет скиллов:** F03, F04, F05, F06, F07, F08, F13, R05, S15, S27

### A08 — BuildAgent-Integrations

- **Уровень:** core
- **Видим в Linear:** no (internal profile/subagent)
- **Миссия:** Реализует adapter/client/webhook code внутри границ, заранее определённых IntegrationAgent и Secrets/Auth plane.
- **Почему нужен:** Нужен отдельный execution profile для внешних интеграций, но auth/onboarding/control-plane обязанности не должны смешиваться с кодированием.
- **Ответственность:**
  - Implement resilient API clients, adapters and webhook handlers
  - Respect integration_brief, auth_decision_record and webhook_contract
  - Consume secret aliases/handles and sanitized auth artifacts instead of raw credentials
  - Handle retries, rate limits, idempotency and schema drift
  - Add observability hooks, failure-mode notes and integration-specific docs updates
- **Входы:** spec, integration_brief, auth_decision_record, webhook_contract, sanitized artifact refs, registry
- **Выходы:** integration code, contract tests, failure-mode notes, observability hooks, updated docs/runbooks
- **Human gate:** Да, если legal/compliance/customer-impacting integration change, production credential access, vendor console action или risky auth decision.
- **Метрики:** integration incident rate, webhook correctness, retry/idempotency coverage, auth-boundary violations avoided
- **Пакет скиллов:** F03, F04, F05, F07, F08, F13, R06, S16, S27, S51, S54

### A09 — BuildAgent-DataMigration

- **Уровень:** core
- **Видим в Linear:** no (internal profile/subagent)
- **Миссия:** Ведёт safe schema/data changes и backfills.
- **Почему нужен:** Это отдельная дисциплина с очень высокой ценой ошибки.
- **Ответственность:**
  - Design migrations
  - Keep backward compatibility
  - Prepare expand/migrate/contract steps
  - Verify data correctness
- **Входы:** migration plan, schema context, data volume/constraints
- **Выходы:** migration scripts, verification queries, rollback notes
- **Human gate:** Да — почти всегда требуется human sign-off.
- **Метрики:** migration rollback rate, data integrity incidents, downtime introduced
- **Пакет скиллов:** F03, F04, F05, F07, F08, F13, S11, S18, S27

### A10 — BuildAgent-InfraIaC

- **Уровень:** core
- **Видим в Linear:** no (internal profile/subagent)
- **Миссия:** Меняет infrastructure-as-code, CI/CD и environment configs по golden path.
- **Почему нужен:** Infra changes требуют отдельного permission model и security posture.
- **Ответственность:**
  - Modify IaC safely
  - Respect least privilege
  - Bootstrap or update CI/CD
  - Prepare rollout notes
- **Входы:** infra plan, environment policy, repo templates
- **Выходы:** IaC diff, pipeline updates, plan/apply notes, rollback path
- **Human gate:** Да — protected environments and high-risk infra changes.
- **Метрики:** failed deploys from infra changes, policy violations, time to safe rollout
- **Пакет скиллов:** F03, F04, F05, F07, F08, F13, S17, S27, S37

### A11 — TestAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Строит и выполняет правильную стратегию доказательства качества.
- **Почему нужен:** Лучшие команды выносят thinking about verification в отдельную capability, а не «добавляют тесты в конце».
- **Ответственность:**
  - Choose test mix
  - Write tests
  - Run fail-first loop
  - Analyze coverage gaps
  - Surface flaky/insufficient tests
- **Входы:** spec, diff, existing tests, coverage data
- **Выходы:** new tests, test plan, gap report, verification results
- **Human gate:** Нет, кроме safety-critical test limitations.
- **Метрики:** test gap catch rate, flaky test reduction, bugs caught before human review
- **Пакет скиллов:** F05, F06, F07, F13, R03, S19, S20, S21, S52

### A12 — ReviewAgent

- **Уровень:** core
- **Видим в Linear:** optional as separate @review later
- **Миссия:** Делает независимый semantic review изменений до human review.
- **Почему нужен:** AI review — отличный baseline, но не заменяет final ownership review.
- **Ответственность:**
  - Semantic diff review
  - Regression hunting
  - Performance/scalability review
  - Review summary and risk ranking
- **Входы:** diff, spec, context pack, test results
- **Выходы:** review findings, severity-ranked comments, go/no-go recommendation
- **Human gate:** Да — человек владеет final review and merge.
- **Метрики:** high-severity bugs found pre-merge, false positive rate, comment usefulness
- **Пакет скиллов:** F02, F05, F06, F07, F13, S21, S22, S23

### A13 — SecurityAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Проверяет secure-by-design и secure-by-implementation аспекты.
- **Почему нужен:** Security — отдельная enabling capability, не просто подвид code review.
- **Ответственность:**
  - Threat modeling
  - Secure coding review
  - Supply chain/dependency risk
  - Secrets/permissions review
  - Security sign-off recommendation
- **Входы:** spec/ADR, diff, deps, env policies, data classification
- **Выходы:** security findings, mitigation recommendations, risk sign-off input
- **Human gate:** Да — для critical/high findings, auth/data/privacy/deletion/security boundary changes.
- **Метрики:** security bugs caught pre-merge, critical findings turnaround, false negative postmortems
- **Пакет скиллов:** F02, F07, F08, F13, S24, S25, S26, S49, S50, S51

### A14 — DocsAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Поддерживает docs как часть delivery, а не как послесловие.
- **Почему нужен:** Сильные AI-native команды вшивают documentation update прямо в pipeline.
- **Ответственность:**
  - Update README/runbooks/ADR index
  - Generate diagrams/summaries
  - Prepare release notes
  - Keep project docs current
  - Preserve raw-secret prohibition in docs, runbooks and integration notes.
- **Входы:** diff, spec, ADR, plan, release artifacts
- **Выходы:** updated docs, changelog, runbook changes, documentation debt notes
- **Human gate:** Да — для customer-facing or policy-critical docs.
- **Метрики:** docs staleness, undocumented change rate, review edits per doc
- **Пакет скиллов:** F03, F06, F13, R07, S27, S28

### A15 — ReleaseAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Ведёт merge/deploy/smoke/rollback orchestration и release communication.
- **Почему нужен:** Release — отдельная инженерная дисциплина, а не «последний git merge».
- **Ответственность:**
  - Check merge gate
  - Trigger merge/deploy flows
  - Run smoke tests
  - Publish release summary
  - Recommend rollback/mitigation when needed
  - Use integration go-live checklists and preserve raw-secret prohibition in release notes.
- **Входы:** PR status, checks, environment policy, smoke plan
- **Выходы:** merge readiness, deployment progress, smoke results, rollback recommendation
- **Human gate:** Да — protected branches, required reviewers, protected environments.
- **Метрики:** failed deployment rate, time to detect bad deploy, rollback correctness
- **Пакет скиллов:** F05, F06, F07, F11, F13, S28, S29, S30, S31, S54

### A16 — MonitoringAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Следит за post-deploy health и помогает в incident triage.
- **Почему нужен:** Done не должно наступать сразу после deploy.
- **Ответственность:**
  - Observe SLO/SLI impact
  - Analyze logs/traces/metrics
  - Compare canary vs baseline
  - Draft postmortem timeline
  - Reopen/rework recommendation
  - Watch vendor/auth/webhook failure signals and integration-specific health indicators.
- **Входы:** telemetry, deployment event, recent diff, alerts
- **Выходы:** monitoring summary, incident triage, rework trigger, postmortem draft
- **Human gate:** Да — для novel incidents, customer-impacting changes, destructive mitigations.
- **Метрики:** MTTD/MTTR assist, escaped issue detection, accuracy of suspect-change detection
- **Пакет скиллов:** F06, F07, F11, F13, S32, S33, S34, S35, S54

### A17 — ProvisionerAgent

- **Уровень:** platform
- **Видим в Linear:** no
- **Миссия:** Поднимает новые repo/project scaffolds и golden paths.
- **Почему нужен:** Это platform-team функция, которая ускоряет все stream-aligned agents.
- **Ответственность:**
  - Create repo scaffolds
  - Bootstrap CI/CD and checks
  - Write initial AGENTS/CLAUDE guidance
  - Sync registry/project links
- **Входы:** project template, registry policy, repo kind, team defaults
- **Выходы:** new repo, pipeline skeleton, guidance files, registry entry
- **Human gate:** Да — on repo creation, secrets setup, environment access.
- **Метрики:** time to first productive repo, template drift, golden-path adoption
- **Пакет скиллов:** F03, F08, F10, R04, R10, S36, S37, S38

### A18 — DependencyAgent

- **Уровень:** platform
- **Видим в Linear:** no
- **Миссия:** Держит зависимости, flags и stale code в здоровом состоянии.
- **Почему нужен:** Это отдельный поток ценности: меньше security debt, меньше toil, меньше hidden regressions.
- **Ответственность:**
  - Dependency refresh
  - Changelog impact analysis
  - Flag cleanup
  - Deprecation issue creation
  - Low-risk maintenance PRs
- **Входы:** dependency graph, advisories, repo metadata, usage signals
- **Выходы:** maintenance PRs, risk summaries, cleanup issues
- **Human gate:** Да — for major version jumps and critical prod-risk updates.
- **Метрики:** mean dependency age, security patch latency, stale flag count
- **Пакет скиллов:** F04, F05, F06, F07, S26, S39, S40

### A19 — EvalsAgent

- **Уровень:** enablement
- **Видим в Linear:** no
- **Миссия:** Измеряет качество агентов, skills и overall engineering system.
- **Почему нужен:** Это enabling team capability для непрерывного улучшения.
- **Ответственность:**
  - Build eval sets
  - Benchmark skill versions
  - Interpret DORA/SPACE/PR metrics
  - Find rework patterns
  - Recommend interventions
- **Входы:** agent outputs, PR outcomes, review comments, incidents, usage metrics
- **Выходы:** quality dashboards, benchmark reports, skill change recommendations, operating reviews
- **Human gate:** Нет, но решения об org/process change принимает человек.
- **Метрики:** eval coverage, signal-to-noise of metrics, time to detect degradation
- **Пакет скиллов:** F12, R02, S41, S42, S45

### A20 — ReporterAgent

- **Уровень:** core
- **Видим в Linear:** no
- **Миссия:** Ведёт диалог в комментариях и переводит внутреннее состояние системы в понятный human-readable слой.
- **Почему нужен:** Без него агентный отдел будет выглядеть «немым» и непредсказуемым.
- **Ответственность:**
  - Respond in comments
  - Summarize progress
  - Surface blockers/questions
  - Resume work on @ask
  - Publish final summaries
  - Never echo raw credentials, raw token state or unsafe troubleshooting details back into Linear comments.
- **Входы:** workflow state, agent artifacts, comments, decision log
- **Выходы:** Linear comments, human questions, status digests, completion summaries
- **Human gate:** Он не принимает product/architecture/deploy решения, только формулирует их для человека.
- **Метрики:** comment response usefulness, clarification efficiency, stakeholder trust
- **Пакет скиллов:** F06, F09, F13, S03, S43, S44

## 5) Каталог скиллов

### 5.1 Базовый foundation-pack (ставится почти всем агентам)

#### F01 — Issue Contract Parser

- **Доступность:** custom
- **Что делает:** Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **Зачем нужен:** Даёт всем агентам одинаковую исходную модель задачи и резко снижает дрейф смысла между triage/spec/build/review.
- **Что строить с нуля:** Входы: issue body, labels, status, project, comments, links. Выход: JSON contract + confidence + missing_fields. Должен уметь учитывать @ask, timestamps, decisions summary, repo registry и optional integration fields: provider_name, integration_kind, auth_scheme, required_credentials, secret_slots, required_scopes, oauth_redirect_uris, webhook_callback_urls, test_strategy, go_live_checklist, rollback_plan.
- **Опора на best practices / источники:** Linear issue contract pattern; OpenAI plan/spec guidance; IntegrationAgent issue-contract extension

#### F02 — Context Pack Builder

- **Доступность:** custom
- **Что делает:** Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **Зачем нужен:** Лучшие агентные пайплайны побеждают не моделью, а качеством контекста.
- **Что строить с нуля:** Должен уметь дедуплицировать контекст, выделять authoritative sources, собирать last relevant comments, decisions summary и отдельно формировать slim prompt context vs full raw log. Для integration-задач включать только sanitized integration artifact refs; не включать raw secrets, raw token state или raw vendor docs dumps.
- **Опора на best practices / источники:** Context-pack best practices; IntegrationAgent context-pack rule

#### F03 — Repo Guidance Interpreter

- **Доступность:** template
- **Что делает:** Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules.
- **Зачем нужен:** Агенты работают лучше, когда инструкции лежат рядом с кодом, а не только в голове команды.
- **Готовая база / ссылка:** [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **Что строить с нуля:** Нужно поддержать layered instructions: global -> org -> repo -> path-specific -> task-specific. Проверять конфликтующие правила и выдавать effective instructions.
- **Опора на best practices / источники:** OpenAI AGENTS.md; Anthropic CLAUDE.md; GitHub custom instructions

#### F04 — Git Hygiene & Branch Safety

- **Доступность:** custom
- **Что делает:** Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **Зачем нужен:** Нужен всем агентам, которые пишут код или готовят PR.
- **Что строить с нуля:** Правила: не работать на dirty tree без явного разрешения, не расширять scope diff, коммитить малыми инкрементами, линковать issue/PR, уважать branch protection.
- **Опора на best practices / источники:** Codex llms-full; GitHub protected branches

#### F05 — Verification Path Executor

- **Доступность:** custom
- **Что делает:** Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **Зачем нужен:** Отделяет «код написан» от «работа доказана».
- **Что строить с нуля:** Поддержка приоритетов: fastest relevant tests first -> full targeted suite -> smoke. Должен логировать exact commands, outputs, artifacts and failures.
- **Опора на best practices / источники:** OpenAI Plan.md/Implement.md guidance; GitHub/Copilot code standards

#### F06 — Structured Summary Writer

- **Доступность:** custom
- **Что делает:** Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **Зачем нужен:** Агентная система умирает, если люди не понимают, что именно уже сделано и что осталось.
- **Что строить с нуля:** Форматы: work summary, blocker summary, question summary, PR summary, release summary, monitoring summary. Всегда указывать facts / unknowns / asks / links.
- **Опора на best practices / источники:** Linear interaction best practices; OpenAI docs phase

#### F07 — Risk Escalation & Human Gate

- **Доступность:** custom
- **Что делает:** Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **Зачем нужен:** Лучшие команды делают людей быстрее, а не выключают их.
- **Что строить с нуля:** Возвращает reason_code, confidence, recommended next step, impact area, rollback note. Триггеры должны быть прозрачными и аудируемыми.
- **Опора на best practices / источники:** user docs human gate; GitHub Copilot required human review; SRE change risk

#### F08 — Secrets, Permissions & Safe Command Guard

- **Доступность:** custom
- **Что делает:** Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **Зачем нужен:** Без этого автономия быстро превращается в безопасность на честном слове.
- **Что строить с нуля:** Нужна allowlist/denylist модель по агентам и режимам (read-only, write, deploy, incident). Логировать каждую escalation и доступ к секретам. Для integration work различать docs_allowlist, sandbox_api_allowlist и release_broker_only; запрещать прямую работу с raw secrets вне broker boundary.
- **Опора на best practices / источники:** Claude subagent tool restrictions; GitHub secure use; Integration runner/network policy

#### F09 — Decision Log & Memory Skill

- **Доступность:** custom
- **Что делает:** Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- **Зачем нужен:** Снижает повторные вопросы и позволяет агентам не тащить всю переписку целиком.
- **Что строить с нуля:** Структура записи: timestamp, actor, decision, rationale, evidence, supersedes, unresolved_questions. Должен обновлять summary инкрементально.
- **Опора на best practices / источники:** user docs on canonical log; Linear promptContext

#### F10 — Repo/Project Registry Resolver

- **Доступность:** custom
- **Что делает:** Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **Зачем нужен:** У тебя это ключевой слой для multi-repo маршрутизации.
- **Что строить с нуля:** Опирается на Repository Registry. Умеет давать confidence и объяснение маршрутизации. Поддерживает repo_kind, environments, team_id, project_id.
- **Опора на best practices / источники:** user docs repo registry

#### F11 — Telemetry & Artifact Linker

- **Доступность:** custom
- **Что делает:** Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **Зачем нужен:** Без сквозной связки человек теряет наблюдаемость над системой.
- **Что строить с нуля:** Должен уметь публиковать canonical URLs обратно в Linear comment/activity и собирать correlation ids.
- **Опора на best practices / источники:** Linear agent session externalUrls; user docs state sync

#### F12 — Evaluation & Benchmark Harness

- **Доступность:** custom
- **Что делает:** Запускает eval-наборы для агентов/скиллов, собирает quality metrics, variance, false-positive/false-negative patterns и regression alerts.
- **Зачем нужен:** Без evals агентная команда деградирует незаметно.
- **Готовая база / ссылка:** [Anthropic skill-creator](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/skill-creator/skills/skill-creator/SKILL.md)
- **Что строить с нуля:** Нужно хранить gold tasks и gold PRs, поддерживать before/after benchmark по skill versions и правила автоотката неудачных изменений.
- **Опора на best practices / источники:** skill-creator; OpenAI/GitHub evaluation recommendations

#### F13 — Sensitive Auth Data Boundary Guard

- **Доступность:** custom
- **Что делает:** Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **Зачем нужен:** Это отдельный boundary-control слой: внешняя интеграция не должна превращать planning/orchestration/docs в хранилище credentials.
- **Что строить с нуля:** Нужен classifier чувствительных полей + redaction/deny-write pipeline по местам записи. Входы: comments, callback payloads, artifacts, docs, db writes. Выходы: sanitized payload, denied_write event, safe summary, audit trail. Должен различать 'можно хранить metadata' vs 'нельзя хранить raw auth truth'.
- **Опора на best practices / источники:** [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/); [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html); [GitHub validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

### 5.2 Готовые/скачиваемые reusable skills и шаблоны

#### R01 — Spec Kit / Spec-Driven Development Toolkit

- **Доступность:** downloadable
- **Что делает:** Открытый toolkit для spec-driven development: помогает вести работу от спецификации к реализации.
- **Зачем нужен:** Лучше всего подходит как база для SpecAgent, ArchitectAgent и PlanAgent.
- **Готовая база / ссылка:** [github/spec-kit](https://github.com/github/spec-kit)
- **Опора на best practices / источники:** GitHub Spec Kit

#### R02 — Anthropic skill-creator

- **Доступность:** downloadable
- **Что делает:** Официальный скилл для создания, улучшения и оценки других скиллов.
- **Зачем нужен:** Нужен для EvalsAgent и для быстрой итерации вашей внутренней skill-библиотеки.
- **Готовая база / ссылка:** [skill-creator](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/skill-creator/skills/skill-creator/SKILL.md)
- **Опора на best practices / источники:** Anthropic official skill

#### R03 — Anthropic webapp-testing

- **Доступность:** downloadable
- **Что делает:** Официальный пример скилла для тестирования веб-приложений.
- **Зачем нужен:** Нужен как база для E2E/TestAgent и smoke/monitoring-проверок UI.
- **Готовая база / ссылка:** [webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- **Опора на best practices / источники:** Anthropic skills repo

#### R04 — Anthropic mcp-builder

- **Доступность:** downloadable
- **Что делает:** Официальный пример скилла для построения MCP-серверов.
- **Зачем нужен:** Полезен ProvisionerAgent и PlatformAgent для расширения tool surface.
- **Готовая база / ссылка:** [mcp-builder](https://github.com/anthropics/skills/tree/main/skills/mcp-builder)
- **Опора на best practices / источники:** Anthropic skills repo

#### R05 — Anthropic frontend-design

- **Доступность:** downloadable
- **Что делает:** Официальный пример скилла для фронтенд/дизайн-задач.
- **Зачем нужен:** Можно адаптировать для FrontendBuildAgent и UX-support workflow.
- **Готовая база / ссылка:** [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
- **Опора на best practices / источники:** Anthropic skills repo

#### R06 — Anthropic claude-api

- **Доступность:** downloadable
- **Что делает:** Официальный пример скилла для работы с Claude API на разных языках.
- **Зачем нужен:** Ускоряет интеграционные/SDK-задачи и обучение BuildAgent API best practices.
- **Готовая база / ссылка:** [claude-api](https://github.com/anthropics/skills/tree/main/skills/claude-api)
- **Опора на best practices / источники:** Anthropic skills repo

#### R07 — Anthropic doc-coauthoring

- **Доступность:** downloadable
- **Что делает:** Официальный пример скилла для совместного написания документов.
- **Зачем нужен:** Хорошая база для DocsAgent, SpecAgent, ADR/PLAN generation.
- **Готовая база / ссылка:** [doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring)
- **Опора на best practices / источники:** Anthropic skills repo

#### R08 — GitHub Copilot Customization Library

- **Доступность:** downloadable
- **Что делает:** Официальная библиотека custom instructions, prompt files и custom agents для Copilot.
- **Зачем нужен:** Готовая база для path-specific instructions, reviewer prompts и language-specific guidance.
- **Готовая база / ссылка:** [Customization library](https://docs.github.com/en/copilot/tutorials/customization-library)
- **Опора на best practices / источники:** GitHub official

#### R09 — Awesome GitHub Copilot

- **Доступность:** downloadable
- **Что делает:** Большая community-коллекция custom agents, instructions, skills, hooks, workflows и plugins для Copilot.
- **Зачем нужен:** Полезна как каталог реальных паттернов и стартовых шаблонов, но требует ревью перед продом.
- **Готовая база / ссылка:** [github/awesome-copilot](https://github.com/github/awesome-copilot)
- **Опора на best practices / источники:** GitHub community collection

#### R10 — OpenAI AGENTS.md Example

- **Доступность:** downloadable
- **Что делает:** Реальный AGENTS.md из openai/codex, хороший reference для repo guidance.
- **Зачем нужен:** Нужен как эталон структуры и степени конкретности для repo-local agent instructions.
- **Готовая база / ссылка:** [openai/codex AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- **Опора на best practices / источники:** OpenAI repo

### 5.3 Role-specific custom skills (строить под твой отдел)

#### S01 — Triage Classifier

- **Доступность:** custom
- **Что делает:** Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- **Зачем нужен:** Основа IntakeAgent.
- **Что строить с нуля:** Модель multilabel classification + confidence + rationale + required next status.
- **Опора на best practices / источники:** user workflow docs

#### S02 — Duplicate & Similar Issue Detector

- **Доступность:** custom
- **Что делает:** Ищет дубликаты, близкие прошлые задачи, связанные PR/incident/postmortem.
- **Зачем нужен:** Снимает шум в Triage.
- **Что строить с нуля:** Использовать semantic search по issue corpus, PR titles, incidents, docs.
- **Опора на best practices / источники:** best practice backlog hygiene

#### S03 — Clarifying Questions Composer

- **Доступность:** custom
- **Что делает:** Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- **Зачем нужен:** Ключевой skill для Needs Input.
- **Что строить с нуля:** Формат: what_missing, why_needed, options, preferred_answer_shape, blocking_vs_optional.
- **Опора на best practices / источники:** user @ask mechanics

#### S04 — Docs & ADR Retriever

- **Доступность:** custom
- **Что делает:** Находит релевантные ADR/spec/runbook/obsidian notes/README по задаче и компоненту.
- **Зачем нужен:** Нужен ContextAgent, ArchitectAgent, ReviewAgent.
- **Что строить с нуля:** Ранжировать по recency, authority, repo/area match, decision relevance.
- **Опора на best practices / источники:** user docs; Linear prompt context

#### S05 — Comment Thread Distiller

- **Доступность:** custom
- **Что делает:** Сжимает длинные треды в canonical decisions summary + unresolved questions.
- **Зачем нужен:** Сильно экономит контекст и снижает потерю решений.
- **Что строить с нуля:** Хранить timeline, speaker, action, open question, superseded notes.
- **Опора на best practices / источники:** user docs canonical conversation log

#### S06 — Issue Contract Generator

- **Доступность:** custom
- **Что делает:** Генерирует строгий issue contract / frontmatter из brief или комментариев.
- **Зачем нужен:** База SpecAgent.
- **Что строить с нуля:** Поля: goal, background, scope, non_goals, acceptance_criteria, verification_path, docs_links, primary_repo, affected_repos, dependencies, risk, done_when, open_questions.
- **Опора на best practices / источники:** user contract doc

#### S07 — Acceptance Criteria Engineer

- **Доступность:** custom
- **Что делает:** Преобразует vague request в тестируемые acceptance criteria и done_when.
- **Зачем нужен:** Без этого build/test дрейфуют.
- **Что строить с нуля:** Разделять user-visible AC и engineering done_when. Выдавать measurable checks.
- **Опора на best practices / источники:** OpenAI long-horizon tasks

#### S08 — Verification Path Designer

- **Доступность:** custom
- **Что делает:** Строит конкретный technical proof path: commands, checks, smoke, manual steps, expected outputs.
- **Зачем нужен:** Связывает spec и test.
- **Что строить с нуля:** Учитывать repo commands, environment constraints, fastest signal path.
- **Опора на best practices / источники:** user contract doc

#### S09 — ADR Writer & Option Matrix

- **Доступность:** custom
- **Что делает:** Пишет ADR с options, trade-offs, risks, migration impact, rollback story.
- **Зачем нужен:** Нужен ArchitectAgent.
- **Что строить с нуля:** Всегда включать context, decision, alternatives, consequences, open risks.
- **Опора на best practices / источники:** architecture best practice

#### S10 — Cross-Repo Impact Analyzer

- **Доступность:** custom
- **Что делает:** Оценивает, какие сервисы/репозитории/consumers затронет изменение.
- **Зачем нужен:** Нужен для multi-repo изменений и release planning.
- **Что строить с нуля:** Строить affected_repos/services/owners/checks/deployments map.
- **Опора на best practices / источники:** user repo registry

#### S11 — Migration & Data Change Planner

- **Доступность:** custom
- **Что делает:** Планирует schema/data migrations, backward compatibility, rollout gates, rollback windows.
- **Зачем нужен:** Критично для high-risk work.
- **Что строить с нуля:** Разделять expand/migrate/contract шаги, backfill, verification, rollback safety.
- **Опора на best practices / источники:** SRE / change management

#### S12 — Work Breakdown & Sub-Issue Generator

- **Доступность:** custom
- **Что делает:** Делит работу на milestones и sub-issues по repo/component/owner.
- **Зачем нужен:** Ядро PlanAgent.
- **Что строить с нуля:** Правила atomicity, dependency graph, parallelizable chunks, repo ownership.
- **Опора на best practices / источники:** user plan docs

#### S13 — Dependency & Sequence Planner

- **Доступность:** custom
- **Что делает:** Строит dependency graph и рекомендует последовательность выполнения.
- **Зачем нужен:** Снижает блокировки и rework.
- **Что строить с нуля:** Явно различать hard/soft dependencies, external blockers, long poles.
- **Опора на best practices / источники:** project planning best practices

#### S14 — Backend Implementation Pack

- **Доступность:** custom
- **Что делает:** Глубокие правила backend-кодинга: API contracts, services, validation, logging, idempotency, error handling, telemetry, feature flags.
- **Зачем нужен:** Основной domain skill для BackendBuildAgent.
- **Что строить с нуля:** Нужно адаптировать под стек каждого repo: language, framework, lint/test/build, package manager, persistence layer.
- **Опора на best practices / источники:** repo-specific best practices

#### S15 — Frontend Implementation Pack

- **Доступность:** custom
- **Что делает:** Правила UI-компонентов, accessibility, state management, routing, forms, loading/error states, design system adherence, analytics hooks.
- **Зачем нужен:** Для FrontendBuildAgent.
- **Что строить с нуля:** Включить responsive, a11y, skeleton/error/empty states, component tests, visual consistency.
- **Опора на best practices / источники:** frontend best practices

#### S16 — Integration/API Builder Pack

- **Доступность:** custom
- **Что делает:** Работа с third-party APIs, retries, rate limits, idempotency keys, webhook handling, auth, schema drift и безопасным потреблением secret aliases/handles вместо raw credentials.
- **Зачем нужен:** Для BuildAgent-Integrations под контролем IntegrationAgent.
- **Что строить с нуля:** Должен генерировать resilient integration code and test doubles. Обязан уважать integration_brief и auth_decision_record, потреблять только sanitized auth artifacts/aliases, строить retry/backoff/idempotency, логирование, DLQ/replay hooks и failure classification.
- **Опора на best practices / источники:** integration engineering best practices; IntegrationAgent execution boundary

#### S17 — Infra & IaC Builder Pack

- **Доступность:** custom
- **Что делает:** Terraform/Pulumi/Kubernetes/GitHub Actions patterns: least privilege, modules, plan/apply discipline, secrets hygiene, rollback notes.
- **Зачем нужен:** Для InfraBuildAgent.
- **Что строить с нуля:** Нужна интеграция с environment policies и protected deploys.
- **Опора на best practices / источники:** GitHub secure use; platform engineering best practice

#### S18 — Data/SQL & Migration Builder Pack

- **Доступность:** custom
- **Что делает:** SQL, indexes, transactions, data integrity, migration safety, backfills, sampling, reconciliation.
- **Зачем нужен:** Для DataMigrationBuildAgent.
- **Что строить с нуля:** Должен уметь generate/explain query plans and safe rollout path.
- **Опора на best practices / источники:** database change best practices

#### S19 — Test Strategy Generator

- **Доступность:** custom
- **Что делает:** Выбирает нужный баланс unit/integration/e2e/contract tests и negative cases.
- **Зачем нужен:** Помогает TestAgent не писать лишнее и не упускать важное.
- **Что строить с нуля:** Вход: risk, component type, blast radius, affected layers. Выход: test plan + priorities.
- **Опора на best practices / источники:** quality engineering best practice

#### S20 — Failing-Test-First Harness

- **Доступность:** custom
- **Что делает:** Побуждает сначала получить fail, потом implementation, потом green.
- **Зачем нужен:** Поддерживает TDD-ish цикл, который DORA прямо усиливает в эпоху AI.
- **Что строить с нуля:** Уметь формировать sentinel test и stop-and-fix rule.
- **Опора на best practices / источники:** DORA TDD and AI

#### S21 — Coverage & Gap Analyzer

- **Доступность:** custom
- **Что делает:** Оценивает, чего в test suite всё ещё не хватает: edge cases, unhappy paths, race conditions, auth cases, migrations.
- **Зачем нужен:** Нужен TestAgent и ReviewAgent.
- **Что строить с нуля:** Использовать diff-aware analysis + existing coverage tools.
- **Опора на best practices / источники:** quality best practice

#### S22 — Semantic PR Reviewer

- **Доступность:** custom
- **Что делает:** Проверяет diff семантически: requirements match, hidden regressions, race conditions, broken invariants, consistency, maintainability.
- **Зачем нужен:** Ключевой skill ReviewAgent.
- **Что строить с нуля:** Нужен high-signal output: issue, severity, evidence, suggested fix, risk of false positive.
- **Опора на best practices / источники:** OpenAI review guidance

#### S23 — Performance & Scalability Reviewer

- **Доступность:** custom
- **Что делает:** Ищет N+1, hot paths, bad queries, unnecessary rerenders, cache misses, concurrency bottlenecks.
- **Зачем нужен:** Часто пропускается обычным code review.
- **Что строить с нуля:** Diff-aware + architecture-aware + telemetry-aware analysis.
- **Опора на best practices / источники:** review best practice

#### S24 — Secure Coding Reviewer

- **Доступность:** custom
- **Что делает:** Проверяет authn/authz, validation, XSS/SSRF/CSRF, secrets, crypto misuse, logging of sensitive data, tenant isolation.
- **Зачем нужен:** Для SecurityAgent и ReviewAgent.
- **Что строить с нуля:** Опирается на OWASP ASVS/SCP, repo threat model, data classification.
- **Опора на best practices / источники:** OWASP ASVS; OWASP Secure Coding; GitLab security engineer

#### S25 — Threat Modeling Assistant

- **Доступность:** custom
- **Что делает:** Строит lightweight threat model для risky features и infra changes.
- **Зачем нужен:** Нужен до кода, а не только после.
- **Что строить с нуля:** Формат: assets, trust boundaries, entry points, abuse cases, mitigations, residual risk.
- **Опора на best practices / источники:** OWASP Secure by Design; NIST SSDF

#### S26 — Supply Chain & Dependency Risk Analyzer

- **Доступность:** custom
- **Что делает:** Оценивает обновления зависимостей, CVEs, transitive risk, semver breakage, changelog impact.
- **Зачем нужен:** Основа DependencyAgent и SecurityAgent.
- **Что строить с нуля:** Поддержка lockfiles, advisories, breaking changes, rollout recommendation.
- **Опора на best practices / источники:** OpenSSF OSPS; GitLab security

#### S27 — Docs Synchronizer

- **Доступность:** custom
- **Что делает:** Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- **Зачем нужен:** OpenAI рекомендует встраивать docs прямо в delivery pipeline.
- **Что строить с нуля:** Detect stale docs from diff; propose exact files to update; generate mermaid when useful. Для integration work обновлять webhook contracts, runbooks, go-live checklists и rollout notes без утечки raw-secret/auth truth.
- **Опора на best practices / источники:** OpenAI docs phase; raw-secret prohibition

#### S28 — Changelog & Release Notes Generator

- **Доступность:** custom
- **Что делает:** Генерирует change summaries из commits/PRs/issues по аудиториям: engineers, stakeholders, customers.
- **Зачем нужен:** Нужен ReleaseAgent и DocsAgent.
- **Что строить с нуля:** Разделять internal-only vs customer-facing, breaking changes, migration notes.
- **Опора на best practices / источники:** release engineering best practice

#### S29 — Merge Gate Checklist

- **Доступность:** custom
- **Что делает:** Проверяет approvals, required checks, CODEOWNERS, deployment constraints, feature flag status, rollback note.
- **Зачем нужен:** Нужен перед merge/deploy.
- **Что строить с нуля:** Ясный yes/no gate with missing_items.
- **Опора на best practices / источники:** GitHub branch protection; CODEOWNERS; environments

#### S30 — Smoke Test Orchestrator

- **Доступность:** custom
- **Что делает:** Запускает post-merge/post-deploy smoke path для ключевых сценариев.
- **Зачем нужен:** Связывает release и monitoring.
- **Что строить с нуля:** Поддержка API/UI/checklist-based smoke, prod-safe only.
- **Опора на best practices / источники:** release/monitoring best practice

#### S31 — Rollback & Mitigation Advisor

- **Доступность:** custom
- **Что делает:** Выбирает безопасный rollback/mitigation path при неудачном деплое или инциденте.
- **Зачем нужен:** Нужен ReleaseAgent и MonitoringAgent.
- **Что строить с нуля:** Варианты: rollback, feature flag off, env disable, traffic shift, revert commit, hotfix.
- **Опора на best practices / источники:** SRE incident/change management

#### S32 — SLO/SLI & Error Budget Interpreter

- **Доступность:** custom
- **Что делает:** Понимает сервисные SLO/SLI, error budget policy и решает, когда нужно заморозить изменения или эскалировать reliability work.
- **Зачем нужен:** Это зрелый operating skill, без которого monitoring формален.
- **Что строить с нуля:** Вход: SLI data, incidents, release cadence. Выход: status, budget health, allowed changes, escalation recommendation.
- **Опора на best practices / источники:** Google SRE error budget

#### S33 — Logs/Traces/Metrics Triage

- **Доступность:** custom
- **Что делает:** Переходит от alert/trace/log anomaly к suspect component, suspect change, repro hints и next actions.
- **Зачем нужен:** Основа MonitoringAgent.
- **Что строить с нуля:** Нужна корреляция telemetry↔deploy↔commit↔issue. Поддержать OTel semantics.
- **Опора на best practices / источники:** OpenTelemetry; OpenAI deploy & maintain

#### S34 — Canary & Post-Deploy Analyzer

- **Доступность:** custom
- **Что делает:** Сравнивает pre/post deploy health, canary vs baseline, performance/error/latency shifts.
- **Зачем нужен:** Позволяет не закрывать issue сразу после deploy.
- **Что строить с нуля:** Поддержка threshold + anomaly + human escalation.
- **Опора на best practices / источники:** monitoring best practice

#### S35 — Incident Timeline & Postmortem Drafter

- **Доступность:** custom
- **Что делает:** Собирает timeline, impact, root-cause hypotheses, contributing factors, follow-up actions.
- **Зачем нужен:** Нужен MonitoringAgent и EvalsAgent.
- **Что строить с нуля:** Без blame, с action items и link to preventing controls.
- **Опора на best practices / источники:** Google SRE incident management

#### S36 — Repo Provisioning Scaffold

- **Доступность:** custom
- **Что делает:** Создаёт новый repo/project scaffold: CI, CODEOWNERS, branch protections, AGENTS.md/CLAUDE.md, issue templates, env skeleton.
- **Зачем нужен:** Основа ProvisionerAgent.
- **Что строить с нуля:** Опирается на repo_kind, template_repo, checks, environments, docs root note.
- **Опора на best practices / источники:** user provisioner concept

#### S37 — CI/CD Workflow Bootstrap

- **Доступность:** custom
- **Что делает:** Поднимает build/test/review/deploy pipelines и required checks по golden path.
- **Зачем нужен:** Для Platform/Provisioner.
- **Что строить с нуля:** Нужно на уровне template repo + validations + secrets policy.
- **Опора на best practices / источники:** GitHub Actions docs

#### S38 — Repository Registry Sync

- **Доступность:** custom
- **Что делает:** Синхронизирует backend registry ↔ Linear projects/labels/links ↔ repo metadata.
- **Зачем нужен:** Критично для маршрутизации и источника истины.
- **Что строить с нуля:** Bi-directional but registry is canonical. Detect drift and propose fixes.
- **Опора на best practices / источники:** user repo registry

#### S39 — Dependency Update Executor

- **Доступность:** custom
- **Что делает:** Автоматизирует safe dependency refresh с changelog summarization, targeted tests, rollout note и rollback plan.
- **Зачем нужен:** Для DependencyAgent.
- **Что строить с нуля:** Batching policy, critical CVE fast lane, low-risk grouped updates.
- **Опора на best practices / источники:** dependency maintenance best practices

#### S40 — Tech Debt & Stale Code Detector

- **Доступность:** custom
- **Что делает:** Находит feature flags to remove, dead code, stale docs, deprecated APIs, low-value toil automation targets.
- **Зачем нужен:** Даёт отделу не только доставку, но и постоянное оздоровление системы.
- **Что строить с нуля:** Регулярные scans + issue creation suggestions ranked by impact.
- **Опора на best practices / источники:** SRE toil elimination

#### S41 — Agent Quality Evaluator

- **Доступность:** custom
- **Что делает:** Измеряет качество работы агентов по acceptance pass rate, review bug yield, rework rate, false positives, merge success, incident escape rate.
- **Зачем нужен:** Для EvalsAgent.
- **Что строить с нуля:** Собирать gold tasks, PR outcome metrics, user feedback and comment reactions.
- **Опора на best practices / источники:** OpenAI/GitHub metrics guidance

#### S42 — DORA & SPACE Metrics Interpreter

- **Доступность:** custom
- **Что делает:** Считает и интерпретирует delivery + developer experience metrics: deployment frequency, lead time, change failure rate, MTTR, plus SPACE dimensions.
- **Зачем нужен:** Нужен для управления отделом, а не только отдельными задачами.
- **Что строить с нуля:** Не сводить всё к одной цифре. Разделять outcome vs activity metrics.
- **Опора на best practices / источники:** DORA; SPACE

#### S43 — Stakeholder Status Reporter

- **Доступность:** custom
- **Что делает:** Пишет summaries для founders/PMs/eng leads: что движется, где риск, что заблокировано, что требует решения.
- **Зачем нужен:** Основа ReporterAgent.
- **Что строить с нуля:** Audience-aware tone; concise; always include next decision point.
- **Опора на best practices / источники:** user ReporterAgent concept

#### S44 — @ask Conversation Handler

- **Доступность:** custom
- **Что делает:** Умеет отличать просто комментарий от явного prompt event с @ask и корректно резюмировать накопившуюся переписку перед ответом.
- **Зачем нужен:** Ключевой skill для работы внутри Linear comments.
- **Что строить с нуля:** Игнорировать @ask в quotes/code blocks; respect current workflow state; create signal/resume semantics.
- **Опора на best practices / источники:** user @ask mechanics

#### S45 — Prompt/Instruction Tuner

- **Доступность:** custom
- **Что делает:** Оптимизирует descriptions/frontmatter/instructions для лучшего triggering accuracy и меньшего prompt bloat.
- **Зачем нужен:** Нужен, потому что skills и AGENTS.md быстро разрастаются и начинают мешать друг другу.
- **Что строить с нуля:** Проводить trigger analysis, undertrigger/overtrigger, ambiguity fixes, brevity optimization.
- **Опора на best practices / источники:** Anthropic skill guide; CLAUDE.md best practices

#### S46 — Integration Type & Auth Scheme Classifier

- **Доступность:** custom
- **Что делает:** Определяет provider_name, integration_kind и auth_scheme: external_api / service_to_service / webhook; api_key / basic / hmac / oauth2_auth_code / oauth2_client_credentials / oauth2_device / webhook_signature / mtls.
- **Зачем нужен:** Первая развилка для IntegrationAgent и IntakeAgent: от неё зависит контракт, gating, runner policy и уровень human involvement.
- **Что строить с нуля:** Входы: issue brief, vendor docs, existing adapters, prior decisions. Выходы: classification + confidence + rationale + missing prerequisites + recommended next steps. Должен уметь распознавать ambiguous/mixed auth модели и эскалировать low-confidence cases.
- **Опора на best practices / источники:** IntegrationAgent supported integration classes; IntegrationAgent supported auth schemes; [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/)

#### S47 — Integration Brief & Auth Decision Record Generator

- **Доступность:** custom
- **Что делает:** Строит integration_brief и auth_decision_record: provider, endpoints, scopes, redirect URIs, callback URLs, rate limits, error model, test strategy, go-live checklist и rollback plan.
- **Зачем нужен:** Это главный артефакт, который разделяет discovery/gating и собственно кодовую реализацию.
- **Что строить с нуля:** Должен выпускать два связанных артефакта: 1) integration_brief для delivery; 2) auth_decision_record с rationale и boundary rules. Включать non-goals, security assumptions, ownership, environments, observability expectations и explicit list of human-gated console actions.
- **Опора на best practices / источники:** IntegrationAgent generated artifacts; IntegrationAgent issue-contract extension; Spec/ADR best practices

#### S48 — Credential Prerequisite Handshake Manager

- **Доступность:** custom
- **Что делает:** Формирует structured Needs Input handoff для secret upload, redirect URI registration, scope approval, OAuth consent completion и webhook registration; никогда не просит raw credential paste.
- **Зачем нужен:** Самая частая точка поломки в интеграциях — не код, а плохой handshake между системой и человеком.
- **Что строить с нуля:** Выход должен содержать what_missing, why_needed, exact console action, accepted answer shape, blocking flag, secure upload path и post-response resume rule. Любой unresolved needs:* prerequisite обязан удерживать issue вне Ready for Build.
- **Опора на best practices / источники:** IntegrationAgent workflow semantics; Operational rules for Needs Input; Linear delegated-contributor comment workflow

#### S49 — Secrets/Auth Plane Metadata Steward

- **Доступность:** custom
- **Что делает:** Работает с metadata-only Secrets/Auth plane: credential_slots, oauth_client_registrations, oauth_consent_sessions, token_handles, webhook_registrations, integration_validation_runs.
- **Зачем нужен:** Нужен, чтобы orchestration layer видел readiness/auth state, но не становился секрет-хранилищем.
- **Что строить с нуля:** Должен поддерживать create/read/update flow для metadata-only сущностей, lookup secret aliases/handles, revoke/rotation state, client registration facts и validation run history. Raw secret material, auth codes и bearer tokens сохранять запрещено.
- **Опора на best practices / источники:** IntegrationAgent storage and security invariants; [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

#### S50 — OAuth Consent & Callback Sanitizer

- **Доступность:** custom
- **Что делает:** Обрабатывает OAuth callback/onboarding flow безопасно: сохраняет только sanitized callback facts, проверяет redirect URI and scope readiness, держит browser-based consent human-in-the-loop.
- **Зачем нужен:** OAuth automation ломается и по безопасности, и по UX, если callback, consent и token-exchange boundaries размыты.
- **Что строить с нуля:** Для MVP: фиксировать provider, consent state, timestamp, requester, safe identifiers и next step; не сохранять raw authorization code. Для последующих фаз: подготовить boundary под broker-driven token exchange/refresh/revoke. Поддерживать PKCE-aware and state-aware reasoning.
- **Опора на best practices / источники:** [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/); [OAuth browser-based apps draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps); IntegrationAgent OAuth callback capture rule

#### S51 — Webhook Contract & Signature Hardening Pack

- **Доступность:** custom
- **Что делает:** Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.
- **Зачем нужен:** Webhook-интеграции чаще всего падают на подписи, повторных доставках и несогласованной модели событий.
- **Что строить с нуля:** Всегда включать secret/signature verification, HTTPS, minimal event subscription, event/action filtering, correlation id, async processing, replay-safe idempotency, delivery diagnostics и smoke checklist. Генерировать webhook_contract и webhook_validation_report.
- **Опора на best practices / источники:** [GitHub validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries); [GitHub best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks); IntegrationAgent generated artifacts

#### S52 — Integration Validation & Sandbox Readiness Orchestrator

- **Доступность:** custom
- **Что делает:** Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.
- **Зачем нужен:** Даже хороший integration code бесполезен, если у команды нет рабочего sandbox, scopes, consent или replayable validation path.
- **Что строить с нуля:** Должен выпускать credential_validation_report и integration_smoke_report. В MVP опирается на текущие metadata routes, sanitized artifacts и DB-backed readiness facts; в будущих фазах расширяется до real broker probes и integration lab/replay tooling.
- **Опора на best practices / источники:** IntegrationAgent readiness contract; Acceptance line for current pass; Not yet accepted as complete integration automation

#### S53 — Integration Runner Capability & Network Policy Matcher

- **Доступность:** custom
- **Что делает:** Сопоставляет integration work с runner capability manifests: networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab.
- **Зачем нужен:** Лучше не запускать интеграционную задачу, чем запустить её на раннере, который физически не может безопасно её выполнить.
- **Что строить с нуля:** На входе issue contract + integration classification + runner manifest. На выходе compatible runners, denied reasons, required network mode, missing capability flags и escalation. Любая несоответствующая задача не должна лизиться non-integration runner'ом.
- **Опора на best practices / источники:** IntegrationAgent runner and network policy; Execution routing best practices

#### S54 — Integration Go-Live, Observability & Rollback Pack

- **Доступность:** custom
- **Что делает:** Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.
- **Зачем нужен:** У внешних интеграций важны не только код и тесты, но и post-deploy visibility, vendor failure modes и безопасный rollback.
- **Что строить с нуля:** Должен включать dashboards/alerts, webhook delivery health, auth failure signals, rate-limit signals, redaction rules для release notes/incident notes, rollback triggers и customer-impact communication hints.
- **Опора на best practices / источники:** IntegrationAgent generated artifacts; Operational rules for release and incident notes; Observability best practices

## 6) Что ставить каждому агенту

### OrchestratorAgent

- **F01 Issue Contract Parser**: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F09 Decision Log & Memory Skill**: Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F11 Telemetry & Artifact Linker**: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S01 Triage Classifier**: Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- **S03 Clarifying Questions Composer**: Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- **S43 Stakeholder Status Reporter**: Пишет summaries для founders/PMs/eng leads: что движется, где риск, что заблокировано, что требует решения.
- **S44 @ask Conversation Handler**: Умеет отличать просто комментарий от явного prompt event с @ask и корректно резюмировать накопившуюся переписку перед ответом.
- **S48 Credential Prerequisite Handshake Manager**: Формирует structured Needs Input handoff для secret upload, redirect URI registration, scope approval, OAuth consent completion и webhook registration; никогда не просит raw credential paste.
- **S52 Integration Validation & Sandbox Readiness Orchestrator**: Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.
- **S53 Integration Runner Capability & Network Policy Matcher**: Сопоставляет integration work с runner capability manifests: networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab.

### IntakeAgent

- **F01 Issue Contract Parser**: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F09 Decision Log & Memory Skill**: Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S01 Triage Classifier**: Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- **S02 Duplicate & Similar Issue Detector**: Ищет дубликаты, близкие прошлые задачи, связанные PR/incident/postmortem.
- **S03 Clarifying Questions Composer**: Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- **S46 Integration Type & Auth Scheme Classifier**: Определяет provider_name, integration_kind и auth_scheme: external_api / service_to_service / webhook; api_key / basic / hmac / oauth2_auth_code / oauth2_client_credentials / oauth2_device / webhook_signature / mtls.

### ContextAgent

- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F09 Decision Log & Memory Skill**: Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F11 Telemetry & Artifact Linker**: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S04 Docs & ADR Retriever**: Находит релевантные ADR/spec/runbook/obsidian notes/README по задаче и компоненту.
- **S05 Comment Thread Distiller**: Сжимает длинные треды в canonical decisions summary + unresolved questions.

### SpecAgent

- **F01 Issue Contract Parser**: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R01 Spec Kit / Spec-Driven Development Toolkit**: Открытый toolkit для spec-driven development: помогает вести работу от спецификации к реализации. — [github/spec-kit](https://github.com/github/spec-kit)
- **R07 Anthropic doc-coauthoring**: Официальный пример скилла для совместного написания документов. — [doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring)
- **S06 Issue Contract Generator**: Генерирует строгий issue contract / frontmatter из brief или комментариев.
- **S07 Acceptance Criteria Engineer**: Преобразует vague request в тестируемые acceptance criteria и done_when.
- **S08 Verification Path Designer**: Строит конкретный technical proof path: commands, checks, smoke, manual steps, expected outputs.

### ArchitectAgent

- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R01 Spec Kit / Spec-Driven Development Toolkit**: Открытый toolkit для spec-driven development: помогает вести работу от спецификации к реализации. — [github/spec-kit](https://github.com/github/spec-kit)
- **S09 ADR Writer & Option Matrix**: Пишет ADR с options, trade-offs, risks, migration impact, rollback story.
- **S10 Cross-Repo Impact Analyzer**: Оценивает, какие сервисы/репозитории/consumers затронет изменение.
- **S11 Migration & Data Change Planner**: Планирует schema/data migrations, backward compatibility, rollout gates, rollback windows.

### PlanAgent

- **F01 Issue Contract Parser**: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R01 Spec Kit / Spec-Driven Development Toolkit**: Открытый toolkit для spec-driven development: помогает вести работу от спецификации к реализации. — [github/spec-kit](https://github.com/github/spec-kit)
- **S12 Work Breakdown & Sub-Issue Generator**: Делит работу на milestones и sub-issues по repo/component/owner.
- **S13 Dependency & Sequence Planner**: Строит dependency graph и рекомендует последовательность выполнения.

### IntegrationAgent

- **F01 Issue Contract Parser**: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **F11 Telemetry & Artifact Linker**: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S46 Integration Type & Auth Scheme Classifier**: Определяет provider_name, integration_kind и auth_scheme: external_api / service_to_service / webhook; api_key / basic / hmac / oauth2_auth_code / oauth2_client_credentials / oauth2_device / webhook_signature / mtls.
- **S47 Integration Brief & Auth Decision Record Generator**: Строит integration_brief и auth_decision_record: provider, endpoints, scopes, redirect URIs, callback URLs, rate limits, error model, test strategy, go-live checklist и rollback plan.
- **S48 Credential Prerequisite Handshake Manager**: Формирует structured Needs Input handoff для secret upload, redirect URI registration, scope approval, OAuth consent completion и webhook registration; никогда не просит raw credential paste.
- **S49 Secrets/Auth Plane Metadata Steward**: Работает с metadata-only Secrets/Auth plane: credential_slots, oauth_client_registrations, oauth_consent_sessions, token_handles, webhook_registrations, integration_validation_runs.
- **S50 OAuth Consent & Callback Sanitizer**: Обрабатывает OAuth callback/onboarding flow безопасно: сохраняет только sanitized callback facts, проверяет redirect URI and scope readiness, держит browser-based consent human-in-the-loop.
- **S51 Webhook Contract & Signature Hardening Pack**: Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.
- **S52 Integration Validation & Sandbox Readiness Orchestrator**: Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.
- **S53 Integration Runner Capability & Network Policy Matcher**: Сопоставляет integration work с runner capability manifests: networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab.
- **S54 Integration Go-Live, Observability & Rollback Pack**: Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.

### BuildAgent-Backend

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R10 OpenAI AGENTS.md Example**: Реальный AGENTS.md из openai/codex, хороший reference для repo guidance. — [openai/codex AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- **S14 Backend Implementation Pack**: Глубокие правила backend-кодинга: API contracts, services, validation, logging, idempotency, error handling, telemetry, feature flags.
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.

### BuildAgent-Frontend

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R05 Anthropic frontend-design**: Официальный пример скилла для фронтенд/дизайн-задач. — [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
- **S15 Frontend Implementation Pack**: Правила UI-компонентов, accessibility, state management, routing, forms, loading/error states, design system adherence, analytics hooks.
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.

### BuildAgent-Integrations

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R06 Anthropic claude-api**: Официальный пример скилла для работы с Claude API на разных языках. — [claude-api](https://github.com/anthropics/skills/tree/main/skills/claude-api)
- **S16 Integration/API Builder Pack**: Работа с third-party APIs, retries, rate limits, idempotency keys, webhook handling, auth, schema drift и безопасным потреблением secret aliases/handles вместо raw credentials.
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- **S51 Webhook Contract & Signature Hardening Pack**: Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.
- **S54 Integration Go-Live, Observability & Rollback Pack**: Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.

### BuildAgent-DataMigration

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S11 Migration & Data Change Planner**: Планирует schema/data migrations, backward compatibility, rollout gates, rollback windows.
- **S18 Data/SQL & Migration Builder Pack**: SQL, indexes, transactions, data integrity, migration safety, backfills, sampling, reconciliation.
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.

### BuildAgent-InfraIaC

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S17 Infra & IaC Builder Pack**: Terraform/Pulumi/Kubernetes/GitHub Actions patterns: least privilege, modules, plan/apply discipline, secrets hygiene, rollback notes.
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- **S37 CI/CD Workflow Bootstrap**: Поднимает build/test/review/deploy pipelines и required checks по golden path.

### TestAgent

- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R03 Anthropic webapp-testing**: Официальный пример скилла для тестирования веб-приложений. — [webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- **S19 Test Strategy Generator**: Выбирает нужный баланс unit/integration/e2e/contract tests и negative cases.
- **S20 Failing-Test-First Harness**: Побуждает сначала получить fail, потом implementation, потом green.
- **S21 Coverage & Gap Analyzer**: Оценивает, чего в test suite всё ещё не хватает: edge cases, unhappy paths, race conditions, auth cases, migrations.
- **S52 Integration Validation & Sandbox Readiness Orchestrator**: Проверяет sandbox/onboarding readiness, credential validation state, test strategy, smoke path и evidence completeness до coding/release stages.

### ReviewAgent

- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S21 Coverage & Gap Analyzer**: Оценивает, чего в test suite всё ещё не хватает: edge cases, unhappy paths, race conditions, auth cases, migrations.
- **S22 Semantic PR Reviewer**: Проверяет diff семантически: requirements match, hidden regressions, race conditions, broken invariants, consistency, maintainability.
- **S23 Performance & Scalability Reviewer**: Ищет N+1, hot paths, bad queries, unnecessary rerenders, cache misses, concurrency bottlenecks.

### SecurityAgent

- **F02 Context Pack Builder**: Собирает компактный контекст-пак из Obsidian, repo guidance, AGENTS.md/CLAUDE.md, linked docs, recent PRs, ADR, PLAN, SPEC, runbooks, project registry и, для integration-задач, sanitized integration artifact references.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S24 Secure Coding Reviewer**: Проверяет authn/authz, validation, XSS/SSRF/CSRF, secrets, crypto misuse, logging of sensitive data, tenant isolation.
- **S25 Threat Modeling Assistant**: Строит lightweight threat model для risky features и infra changes.
- **S26 Supply Chain & Dependency Risk Analyzer**: Оценивает обновления зависимостей, CVEs, transitive risk, semver breakage, changelog impact.
- **S49 Secrets/Auth Plane Metadata Steward**: Работает с metadata-only Secrets/Auth plane: credential_slots, oauth_client_registrations, oauth_consent_sessions, token_handles, webhook_registrations, integration_validation_runs.
- **S50 OAuth Consent & Callback Sanitizer**: Обрабатывает OAuth callback/onboarding flow безопасно: сохраняет только sanitized callback facts, проверяет redirect URI and scope readiness, держит browser-based consent human-in-the-loop.
- **S51 Webhook Contract & Signature Hardening Pack**: Проектирует и проверяет webhook contracts: callback URL, event filtering, signature verification, replay/idempotency handling, retry/DLQ strategy, timeout behavior, delivery correlation и verification reports.

### DocsAgent

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **R07 Anthropic doc-coauthoring**: Официальный пример скилла для совместного написания документов. — [doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring)
- **S27 Docs Synchronizer**: Обновляет README, runbooks, ADR index, module docs, PR summary, diagrams и release notes при изменении кода.
- **S28 Changelog & Release Notes Generator**: Генерирует change summaries из commits/PRs/issues по аудиториям: engineers, stakeholders, customers.

### ReleaseAgent

- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F11 Telemetry & Artifact Linker**: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S28 Changelog & Release Notes Generator**: Генерирует change summaries из commits/PRs/issues по аудиториям: engineers, stakeholders, customers.
- **S29 Merge Gate Checklist**: Проверяет approvals, required checks, CODEOWNERS, deployment constraints, feature flag status, rollback note.
- **S30 Smoke Test Orchestrator**: Запускает post-merge/post-deploy smoke path для ключевых сценариев.
- **S31 Rollback & Mitigation Advisor**: Выбирает безопасный rollback/mitigation path при неудачном деплое или инциденте.
- **S54 Integration Go-Live, Observability & Rollback Pack**: Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.

### MonitoringAgent

- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **F11 Telemetry & Artifact Linker**: Связывает issue, workflow run, branch, PR, checks, deployment, dashboards, logs и agent session external URLs.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S32 SLO/SLI & Error Budget Interpreter**: Понимает сервисные SLO/SLI, error budget policy и решает, когда нужно заморозить изменения или эскалировать reliability work.
- **S33 Logs/Traces/Metrics Triage**: Переходит от alert/trace/log anomaly к suspect component, suspect change, repro hints и next actions.
- **S34 Canary & Post-Deploy Analyzer**: Сравнивает pre/post deploy health, canary vs baseline, performance/error/latency shifts.
- **S35 Incident Timeline & Postmortem Drafter**: Собирает timeline, impact, root-cause hypotheses, contributing factors, follow-up actions.
- **S54 Integration Go-Live, Observability & Rollback Pack**: Готовит integration_go_live_checklist, observability hooks, smoke path, release notes constraints и rollback/mitigation plan для внешних интеграций.

### ProvisionerAgent

- **F03 Repo Guidance Interpreter**: Понимает и применяет AGENTS.md, CLAUDE.md, path-specific instructions, prompt files, repo-local conventions, build/test commands, code style и release rules. — [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/)
- **F08 Secrets, Permissions & Safe Command Guard**: Контролирует, какие команды, токены, environments, MCP tools и file paths доступны агенту; запрещает опасные действия вне policy.
- **F10 Repo/Project Registry Resolver**: Разрешает mapping issue/project/area -> primary_repo / affected_repos / service_dependencies / required_checks / environments.
- **R04 Anthropic mcp-builder**: Официальный пример скилла для построения MCP-серверов. — [mcp-builder](https://github.com/anthropics/skills/tree/main/skills/mcp-builder)
- **R10 OpenAI AGENTS.md Example**: Реальный AGENTS.md из openai/codex, хороший reference для repo guidance. — [openai/codex AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- **S36 Repo Provisioning Scaffold**: Создаёт новый repo/project scaffold: CI, CODEOWNERS, branch protections, AGENTS.md/CLAUDE.md, issue templates, env skeleton.
- **S37 CI/CD Workflow Bootstrap**: Поднимает build/test/review/deploy pipelines и required checks по golden path.
- **S38 Repository Registry Sync**: Синхронизирует backend registry ↔ Linear projects/labels/links ↔ repo metadata.

### DependencyAgent

- **F04 Git Hygiene & Branch Safety**: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- **F05 Verification Path Executor**: Понимает verification_path из контракта и умеет запускать нужные тесты, линтеры, smoke steps, coverage, security scans и ручные checklists.
- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F07 Risk Escalation & Human Gate**: Умеет останавливать автономный ход и переводить задачу в human decision при security, payments, auth, migrations, destructive ops, ambiguous scope или low confidence.
- **S26 Supply Chain & Dependency Risk Analyzer**: Оценивает обновления зависимостей, CVEs, transitive risk, semver breakage, changelog impact.
- **S39 Dependency Update Executor**: Автоматизирует safe dependency refresh с changelog summarization, targeted tests, rollout note и rollback plan.
- **S40 Tech Debt & Stale Code Detector**: Находит feature flags to remove, dead code, stale docs, deprecated APIs, low-value toil automation targets.

### EvalsAgent

- **F12 Evaluation & Benchmark Harness**: Запускает eval-наборы для агентов/скиллов, собирает quality metrics, variance, false-positive/false-negative patterns и regression alerts. — [Anthropic skill-creator](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/skill-creator/skills/skill-creator/SKILL.md)
- **R02 Anthropic skill-creator**: Официальный скилл для создания, улучшения и оценки других скиллов. — [skill-creator](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/skill-creator/skills/skill-creator/SKILL.md)
- **S41 Agent Quality Evaluator**: Измеряет качество работы агентов по acceptance pass rate, review bug yield, rework rate, false positives, merge success, incident escape rate.
- **S42 DORA & SPACE Metrics Interpreter**: Считает и интерпретирует delivery + developer experience metrics: deployment frequency, lead time, change failure rate, MTTR, plus SPACE dimensions.
- **S45 Prompt/Instruction Tuner**: Оптимизирует descriptions/frontmatter/instructions для лучшего triggering accuracy и меньшего prompt bloat.

### ReporterAgent

- **F06 Structured Summary Writer**: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- **F09 Decision Log & Memory Skill**: Поддерживает compact decision log: какие решения приняты, когда, кем, на основании чего; умеет резюмировать длинные comment threads.
- **F13 Sensitive Auth Data Boundary Guard**: Следит, чтобы raw secret values, authorization codes, access/refresh tokens и raw token state никогда не попадали в Linear comments, Obsidian notes, repo docs, artifact_registry, context packs или prompt bundles; пропускает только sanitized metadata, aliases, handles и artifact references.
- **S03 Clarifying Questions Composer**: Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- **S43 Stakeholder Status Reporter**: Пишет summaries для founders/PMs/eng leads: что движется, где риск, что заблокировано, что требует решения.
- **S44 @ask Conversation Handler**: Умеет отличать просто комментарий от явного prompt event с @ask и корректно резюмировать накопившуюся переписку перед ответом.

## 7) Минимальный стартовый набор (если запускать по волнам)

### Волна 1 — control plane и safe delivery core

- OrchestratorAgent
- IntakeAgent
- ContextAgent
- SpecAgent
- PlanAgent
- IntegrationAgent
- BuildAgent-Backend
- TestAgent
- ReviewAgent
- ReporterAgent
- ReleaseAgent

### Волна 2 — quality / security / product-surface expansion

- ArchitectAgent
- SecurityAgent
- MonitoringAgent
- BuildAgent-Frontend
- BuildAgent-Integrations
- DocsAgent

### Волна 3 — platform / enablement

- BuildAgent-DataMigration
- BuildAgent-InfraIaC
- ProvisionerAgent
- DependencyAgent
- EvalsAgent

Если у тебя интеграции — core surface продукта уже сейчас, подними `BuildAgent-Integrations` вместе с `IntegrationAgent` в первую волну.

## 8) Жёсткие правила проектирования skill-библиотеки

- Skill должен быть **коротким в trigger-описании, но глубоким в execution logic**.
- Всё, что нужно почти всегда, кладётся в `AGENTS.md` / `CLAUDE.md`; всё, что нужно не всегда — в отдельные skills.
- Skills должны быть **композируемыми**: не предполагать, что они единственные активные.
- Каждый skill должен иметь: `when to use`, `inputs`, `steps`, `stop conditions`, `escalation rules`, `example outputs`, `anti-patterns`.
- Для risky skills обязательны **denied actions** и явные human gates.
- Нужны eval-наборы: gold tasks, gold PRs, good/bad review comments, known failure cases.
- Для integration-related skills дополнительно обязателен **raw-secret prohibition** и чёткое разделение `metadata plane` vs `credential plane`.

## 9) Что я бы добавил именно в твою схему

- Оставить одного видимого Linear-агента и не плодить шумных app users.
- BuildAgent сделать не одним агентом, а **семейством профилей**: backend / frontend / integrations / data / infra.
- Добавить **отдельный Secrets/Auth plane** как источник истины для credential/auth metadata, а не размазывать это по Linear, Obsidian, repo docs и prompt bundles.
- Жёстко развести `IntegrationAgent` и `BuildAgent-Integrations`: первый — про readiness/auth/onboarding/control-plane, второй — про код.
- SecurityAgent и MonitoringAgent не делать опциональными навсегда — для внешних интеграций это часть минимально зрелой системы.
- EvalsAgent запустить раньше, чем кажется нужным: иначе skill zoo начнёт расти хаотично.
- ReporterAgent должен быть отдельной capability, потому что хороший execution без прозрачной коммуникации воспринимается как «ничего не происходит».
- Внести integration-specific reason codes и gating rules прямо в orchestration layer: unresolved `needs:*` prerequisites не пускают задачу в `Ready for Build`.

## 10) Как учитывать IntegrationAgent в твоём текущем проекте прямо сейчас

### 10.1 Canonical truth split

- **Linear:** operator visibility, ownership, status, comments, Needs Input handshake
- **Temporal_or_workflow_engine:** execution truth and orchestration sequencing
- **GitHub:** code, CI/CD, merge/deploy gates
- **Obsidian:** architecture, runbooks, policy, long-lived docs
- **Secrets/Auth plane:** secret aliases, client registrations, redirect URIs, scopes, consent state, token-handle metadata, webhook signing metadata, rotation/revoke state

### 10.2 Что уже считается shipped foundation в текущем проходе

- Shared contracts and enums for integration kinds, auth schemes, consent/token/webhook state, runner capability manifests
- Postgres schema + migration for metadata-only Secrets/Auth plane tables
- Issue-contract parser support for integration-specific fields
- Control API inspection routes for integration state
- Public OAuth callback capture route that persists only sanitized callback facts
- Context-pack support for sanitized integration artifact references
- Workflow-config updates for integration-specific triggers and reason codes
- Minimal IntegrationOnboardingWorkflow skeleton for future human-gated onboarding orchestration

### 10.3 Acceptance line для текущего implementation pass

- corepack pnpm typecheck passes
- corepack pnpm test passes
- corepack pnpm test:integration passes in current environment or skips only DB-dependent cases when DATABASE_URL is absent
- New metadata tables are present in migrations and exported through the DB package
- /internal/issues/:issueId/integrations/* routes are available and authenticated
- /oauth/callback/:providerName exists and does not persist raw authorization codes
- Context packs can expose sanitized integration artifact references without exposing auth truth

### 10.4 Что пока **нельзя** называть complete integration automation

- live secret broker service or equivalent backend integration
- OAuth token exchange/refresh/revoke execution behind the broker boundary
- real integration-lab sandbox probes and replay tooling
- strict routing so only integration-capable runners can lease integration work
- e2e success path for API-key, OAuth2 Authorization Code + PKCE, and signed webhook onboarding

### 10.5 Workflow invariants

- **Новый top-level status:** нет
- **Needs Input** используется для:
  - secret upload
  - redirect URI registration
  - scope approval
  - OAuth consent completion
  - webhook registration
- **Blocked** используется для:
  - sandbox outage
  - invalid scopes
  - webhook verification failure
  - token expiry/revoke without recovery
  - vendor or broker outage
- **Ready for Build** запрещён, пока не закрыты integration prerequisites: да

### 10.6 Supported integration classes и auth schemes

- **Integration classes:** external_api, service_to_service, webhook
- **Auth schemes:** api_key, basic, hmac, oauth2_auth_code, oauth2_client_credentials, oauth2_device, webhook_signature, mtls

### 10.7 Issue-contract extension

- `provider_name`
- `integration_kind`
- `auth_scheme`
- `required_credentials`
- `secret_slots`
- `required_scopes`
- `oauth_redirect_uris`
- `sandbox_account_required`
- `webhook_required`
- `webhook_callback_urls`
- `rate_limit_notes`
- `error_model`
- `test_strategy`
- `go_live_checklist`
- `rollback_plan`

### 10.8 Generated sanitized artifacts

- `integration_brief`
- `auth_decision_record`
- `credential_request`
- `credential_validation_report`
- `oauth_consent_session`
- `webhook_contract`
- `webhook_validation_report`
- `integration_smoke_report`
- `integration_go_live_checklist`

### 10.9 Runner и network policy

- **Capability manifest fields:** networkModesSupported, allowedDocDomains, allowedSandboxDomains, supportsBrowserConsent, supportsSecretBroker, supportsOAuthBroker, supportsIntegrationLab
- **Allowed network modes:** docs_allowlist, sandbox_api_allowlist, release_broker_only
- **Browser-based consent:** human in the loop

### 10.10 Context-pack rule

- Context packs may include sanitized integration artifact references from artifact_registry
- Context packs must not include raw vendor docs dumps, raw secrets, or raw token state
- Integration artifacts augment the existing context pack; they do not replace knowledge-service truth

### 10.11 Ownership boundary

- **packages/shared:** DTOs, enums, capability manifest, issue-contract extension
- **packages/db:** metadata-only auth-plane schema, read/write helpers, context artifact lookup
- **apps/control-api:** internal read routes, public OAuth callback capture
- **apps/workflow-worker:** issue-contract normalization, workflow-config consumption, onboarding workflow skeleton
- **Obsidian:** canonical architecture, runbooks

## 11) Короткая финальная рекомендация

Если свести всё к одному решению: **строй не «команду из AI-должностей», а «производственную систему из agent capabilities»**. Human roles остаются владельцами intent, architecture/risk sign-off, финальных gate-решений и credential authority. Агентам отдаётся repeatable инженерная работа по всему lifecycle: от triage и spec до integration onboarding, review, release и post-deploy monitoring.

В твоей конкретной схеме `IntegrationAgent` должен считаться **ядром AI-отдела**, потому что он закрывает ту часть engineering system, которую ни один обычный BuildAgent качественно не закроет: auth model selection, secure prerequisite handshake, sanitized artifacts, runner/network fit и безопасную линию между readiness и real external automation.
