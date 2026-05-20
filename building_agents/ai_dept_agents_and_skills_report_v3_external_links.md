
# AI-отдел разработки: карта внешних skills по агентам (v3)

Этот файл — **дополнение** к твоему `ai_dept_agents_and_skills_report_v2.md`, а не замена ему.  
Базовая логика ролей, статусов, @ask-механики и source-of-truth split остаётся такой, как у тебя уже зафиксировано в текущем отчёте и сопутствующих документах.

## Как читать этот файл

- **Keep** — что из твоего кастомного набора v2 я бы точно оставил как internal truth.
- **P0 / GitHub** — внешние skills, которые хорошо ложатся **прямо сейчас** и имеют высокий fit к твоей архитектуре.
- **P0 / SkillsMP** — находки из банка skills, которые дают быстрый coverage gap fill.
- **P1** — опциональные навыки на следующую волну, если расширяешь tool surface.

## Общий принцип отбора

1. **Не заменять** твои core custom skills, а **усилять** ими роли.
2. Приоритет: **official team skills** и repo-native skills → затем сильные community skills → затем marketplace skills как ускоритель discovery.
3. Для risky ролей — сначала security / review / observability / gating, только потом convenience skills.
4. Для integration-heavy ролей — приоритет OAuth/webhook/auth readiness и release/rollback visibility.
5. Если один и тот же навык есть и как GitHub-source, и как SkillsMP listing, **каноничным source** лучше считать GitHub-репозиторий, а SkillsMP использовать как discovery/install surface.

## Главная рекомендация по установке

Не пытайся навесить всё на всех.  
Сделай 4 общих bundle:

- **Control plane**: orchestration, Linear, GitHub routing, memory, context.
- **Spec/Plan/Architecture**: spec-driven development, ADR, PRD, task planning.
- **Quality/Security**: review, testing, threat modeling, static analysis, observability.
- **Integration/Release**: OAuth, webhooks, CI/CD, release notes, rollback.

Дальше каждому агенту назначай только его slice из этих bundle.

## A00 — OrchestratorAgent
**Keep:** Сохраняет твой текущий foundation-pack и orchestration custom skills из v2: F01/F02/F03/F06/F07/F08/F09/F10/F11/F13 + S01/S03/S43/S44/S48/S52/S53.

**P0 / GitHub**
- [openai/linear](https://github.com/openai/skills/tree/main/skills/.curated/linear) — управление issues/projects/workflows в Linear
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github) — PR/branch/review workflow patterns
- [obra/subagent-driven-development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md) — модель координации нескольких специализированных агентов
- [muratcankoylan/multi-agent-patterns](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/multi-agent-patterns) — паттерны orchestrator / hierarchical / peer-to-peer
- [ShunsukeHayashi/agent-skill-bus](https://github.com/ShunsukeHayashi/agent-skill-bus) — runtime-слой для health/dependency/self-improvement навыков

**P0 / SkillsMP**
- [triage-agent](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-vishal2457-open-orchestra-triage-agent-skill-md) — быстрый execution-track triage
- [linear-projects](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-finesssee-linear-cli-linear-projects-skill-md) — операции по проектам Linear
- [multi-agent-dispatch](https://skillsmp.com/skills/patrick-yingxi-pan-openclaw-skills-multi-agent-dispatch-skill-md) — диспетчеризация параллельных подагентов

**P1 / optional**
- [linear-cli](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-rolaca11-linear-cli-linear-cli-skill-md) — если хочешь отдельный CLI-route поверх GraphQL

**Почему это подходит:** Для твоей схемы с одним видимым Linear-agent’ом, @ask-механикой и execution truth вне Linear этот набор сильнее всего усиливает control-plane.

## A01 — IntakeAgent
**Keep:** Сохраняет F01/F02/F09/F10/F13 + S01/S02/S03/S46.

**P0 / GitHub**
- [trailofbits/ask-questions-if-underspecified](https://github.com/trailofbits/skills/tree/main/plugins/ask-questions-if-underspecified) — жёсткая дисциплина уточняющих вопросов
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github) — routing в GitHub/PR-потоки
- [mattpocock/skills](https://github.com/mattpocock/skills) — issue triage, PRD writing, git guardrails, refactoring plans

**P0 / SkillsMP**
- [triage-agent](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-vishal2457-open-orchestra-triage-agent-skill-md) — классификация parent issue на trivial|standard|complex
- [triage-v4](https://skillsmp.com/skills/drdatarulz-ti-engineering-standards-skills-triage-v4-skill-md) — interactive bug triage без написания кода

**Почему это подходит:** Intake у тебя завязан на строгую типизацию задачи и корректный handshake со статусами; эти навыки уменьшают ложные маршруты и ранние ambiguity loops.

## A02 — ContextAgent
**Keep:** Сохраняет F02/F03/F09/F10/F11/F13 + S04/S05.

**P0 / GitHub**
- [trailofbits/audit-context-building](https://github.com/trailofbits/skills/tree/main/plugins/audit-context-building) — глубокая сборка архитектурного контекста
- [openai/pdf](https://github.com/openai/skills/tree/main/skills/.curated/pdf) — извлечение и review PDF-артефактов
- [openai/doc](https://github.com/openai/skills/tree/main/skills/.curated/doc) — работа с .docx-контекстом
- [muratcankoylan/memory-systems](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/memory-systems) — долгая память и retrieval architecture

**P0 / SkillsMP**
- [agent-memory-systems](https://skillsmp.com/skills/keenanhusselmann-basket-buddy-claude-skills-agent-memory-systems-skill-md) — архитектура памяти агента
- [agent-memory](https://skillsmp.com/skills/octaviantocan-agent-memory-skills-agent-memory-skill-md) — операционная память с hook/db
- [ck-context](https://skillsmp.com/skills/kristiansnts-context-keeper-plugin-skills-ck-context-skill-md) — project context dump

**Почему это подходит:** У тебя context pack — главный мультипликатор качества. Эти навыки усиливают именно retrieval, compression и long-running memory слой.

## A03 — SpecAgent
**Keep:** Сохраняет F01/F02/F06/F07/F13 + R01/R07 + S06/S07/S08.

**P0 / GitHub**
- [anthropics/doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring) — совместное производство спецификаций
- [google-labs-code/design-md](https://github.com/google-labs-code/stitch-skills/tree/main/skills/design-md) — структура DESIGN.md / design artifacts
- [NeoLabHQ/sdd](https://github.com/NeoLabHQ/context-engineering-kit/tree/master/plugins/sdd) — spec-driven development workflow

**P0 / SkillsMP**
- [spec-driven-development](https://skillsmp.com/skills/jasonkneen-kiro-skills-spec-driven-development-skill-md) — 3-фазный requirements → design → tasks
- [generate-spec](https://skillsmp.com/skills/stvangaal-arboretum-claude-skills-generate-spec-skill-md) — governed spec generation
- [prd](https://skillsmp.com/skills/github-awesome-copilot-skills-prd-skill-md) — формализация PRD/requirements
- [plan-and-spec](https://skillsmp.com/skills/reedmayhew18-claude-code-expert-claude-skills-plan-and-spec-skill-md) — multi-iteration design before coding

**Почему это подходит:** SpecAgent у тебя — точка, где vague brief превращается в исполнимый контракт. Здесь лучше всего работают spec-driven и doc-authoring навыки.

## A04 — ArchitectAgent
**Keep:** Сохраняет F02/F06/F07/F10/F13 + R01 + S09/S10/S11.

**P0 / GitHub**
- [openai/security-threat-model](https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model) — repo-specific threat modeling
- [muratcankoylan/multi-agent-patterns](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/multi-agent-patterns) — архитектура coordination patterns
- [cloudflare/agents-sdk](https://github.com/cloudflare/skills/tree/main/skills/agents-sdk) — архитектурные паттерны для stateful agent systems
- [NeoLabHQ/sdd](https://github.com/NeoLabHQ/context-engineering-kit/tree/master/plugins/sdd) — design-first discipline

**P0 / SkillsMP**
- [create-adr](https://skillsmp.com/skills/majesticlabs-dev-majestic-marketplace-plugins-majestic-engineer-skills-create-adr-skill-md) — быстрый ADR pipeline
- [adr](https://skillsmp.com/skills/altierispeixoto-lugh-plugins-lugh-skills-adr-skill-md) — MADR-compatible ADR authoring
- [architecture-designer](https://skillsmp.com/skills/jeffallan-claude-skills-skills-architecture-designer-skill-md) — system design / scalability / ADR authoring
- [tmdd-threat-modeling](https://skillsmp.com/skills/attasec-tmdd-agents-cursor-skill-skill-md) — threat-modeling driven development

**Почему это подходит:** ArchitectAgent должен закрывать не только ADR, но и risk-first design. Поэтому сюда лучше ставить threat-modeling и architecture workflow навыки.

## A05 — PlanAgent
**Keep:** Сохраняет F01/F06/F10/F13 + R01 + S12/S13.

**P0 / GitHub**
- [NeoLabHQ/sdd](https://github.com/NeoLabHQ/context-engineering-kit/tree/master/plugins/sdd) — декомпозиция от spec к tasks
- [obra/subagent-driven-development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md) — раскладка работ под subagents
- [mattpocock/skills](https://github.com/mattpocock/skills) — issue triage, refactor plans, PRD writing

**P0 / SkillsMP**
- [plan-and-spec](https://skillsmp.com/skills/reedmayhew18-claude-code-expert-claude-skills-plan-and-spec-skill-md) — implementation plan + spec-driven modeling
- [spec-workflow](https://skillsmp.com/skills/tzachbon-smart-ralph-plugins-ralph-specum-skills-spec-workflow-skill-md) — workflow от research до tasks
- [refactor-plan](https://skillsmp.com/skills/multicam-qara-claude-skills-refactor-plan-skill-md) — если план идёт через restructuring

**Почему это подходит:** PlanAgent у тебя — bridge между контрактом и execution. Ему важнее разложение по зависимостям и подагентам, чем доменные implementation skills.

## A21 — IntegrationAgent
**Keep:** Сохраняет F01/F02/F03/F06/F07/F08/F10/F11/F13 + S46/S47/S48/S49/S50/S51/S52/S53/S54.

**P0 / GitHub**
- [ComposioHQ/skills](https://github.com/ComposioHQ/skills) — готовые app integrations и auth-managed connectors
- [stripe/stripe-best-practices](https://github.com/stripe/ai/tree/main/skills/stripe-best-practices) — best practices для платежных интеграций
- [better-auth/best-practices](https://github.com/better-auth/skills/tree/main/better-auth/best-practices) — auth integration guardrails
- [better-auth/create-auth](https://github.com/better-auth/skills/tree/main/better-auth/create-auth) — auth setup workflow
- [cloudflare/building-mcp-server-on-cloudflare](https://github.com/cloudflare/skills/tree/main/skills/building-mcp-server-on-cloudflare) — tool/API adapters с OAuth и remote MCP

**P0 / SkillsMP**
- [oauth-integrator](https://skillsmp.com/skills/aretedriver-ai-skills-personas-api-oauth-integrator-skill-md) — OAuth 2.0 flows, refresh/revoke, JWT validation
- [oauth-integrations](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-jezweb-claude-skills-oauth-integrations-skill-md) — edge/OAuth callbacks и provider quirks
- [performing-oauth-scope-minimization-review](https://skillsmp.com/skills/autohandai-community-skills-performing-oauth-scope-minimization-review-skill-md) — scope minimization / least-privilege review
- [webhook-security](https://skillsmp.com/skills/vanman2024-ai-dev-marketplace-plugins-payments-skills-webhook-security-skill-md) — signature verification, replay protection, testing
- [hookdeck-event-gateway](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-hookdeck-webhook-skills-hookdeck-event-gateway-skill-md) — durable webhook ingress / retries

**P1 / optional**
- [integrating-stripe-webhooks](https://skillsmp.com/skills/pr-pm-prpm-claude-skills-integrating-stripe-webhooks-skill-md) — если Stripe — core surface
- [webhook-expert](https://skillsmp.com/skills/willsigmon-sigstack-plugins-automation-skills-webhook-expert-skill-md) — если webhook-heavy estate

**Почему это подходит:** Это самый важный внешний набор для твоей схеме: именно здесь живут auth model, consent, webhook hardening, sandbox readiness и go-live boundary.

## A06 — BuildAgent-Backend
**Keep:** Сохраняет F03/F04/F05/F06/F07/F08/F13 + R10 + S14/S27.

**P0 / GitHub**
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github) — git/PR discipline
- [better-auth/create-auth](https://github.com/better-auth/skills/tree/main/better-auth/create-auth) — auth-heavy backend setup
- [cloudflare/agents-sdk](https://github.com/cloudflare/skills/tree/main/skills/agents-sdk) — stateful agent/backend patterns
- [openai/gh-fix-ci](https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci) — быстрый repair для CI failures
- [trailofbits/fix-review](https://github.com/trailofbits/skills/tree/main/plugins/fix-review) — верификация, что fix не внёс новых багов

**P0 / SkillsMP**
- [implement](https://skillsmp.com/skills/nklisch-skills-plugins-workflow-skills-implement-skill-md) — кодирование по уже готовому design/plan
- [github-actions](https://skillsmp.com/skills/asonnleitner-skills-github-actions-skill-md) — если backend build тесно завязан на Actions

**Почему это подходит:** Backend-профиль у тебя уже очень сильный кастомно; извне лучше добирать не общие советы, а фиксацию CI/auth/fix-loop дисциплины.

## A07 — BuildAgent-Frontend
**Keep:** Сохраняет F03/F04/F05/F06/F07/F08/F13 + R05 + S15/S27.

**P0 / GitHub**
- [anthropics/frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) — UI/UX workflow
- [vercel/react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) — React patterns
- [vercel/next-best-practices](https://github.com/vercel-labs/next-skills/tree/main/skills/next-best-practices) — Next.js patterns
- [google-labs-code/react-components](https://github.com/google-labs-code/stitch-skills/tree/main/skills/react-components) — design-to-component flow
- [google-labs-code/shadcn-ui](https://github.com/google-labs-code/stitch-skills/tree/main/skills/shadcn-ui) — component generation on shadcn/ui
- [figma/figma-implement-design](https://github.com/figma/mcp-server-guide/tree/main/skills/figma-implement-design) — перенос дизайна в production code
- [figma/figma-code-connect-components](https://github.com/figma/mcp-server-guide/tree/main/skills/figma-code-connect-components) — связка design components ↔ code components
- [cloudflare/web-perf](https://github.com/cloudflare/skills/tree/main/skills/web-perf) — Core Web Vitals / performance review

**P0 / SkillsMP**
- [playwright-e2e-test-generator](https://skillsmp.com/skills/agentskillexchange-skills-skills-playwright-e2e-test-generator-skill-md) — если фронт требует сразу генерировать smoke/e2e

**Почему это подходит:** По frontend лучше ставить связку design-system → implementation → perf, а не только generic UI skills.

## A08 — BuildAgent-Integrations
**Keep:** Сохраняет F03/F04/F05/F07/F08/F13 + R06 + S16/S27/S51/S54.

**P0 / GitHub**
- [ComposioHQ/skills](https://github.com/ComposioHQ/skills) — готовые app/tool integrations
- [stripe/stripe-best-practices](https://github.com/stripe/ai/tree/main/skills/stripe-best-practices) — платежные API patterns
- [better-auth/create-auth](https://github.com/better-auth/skills/tree/main/better-auth/create-auth) — auth setup для интеграций
- [cloudflare/building-mcp-server-on-cloudflare](https://github.com/cloudflare/skills/tree/main/skills/building-mcp-server-on-cloudflare) — MCP/API adapters
- [googleworkspace/gws-shared](https://github.com/googleworkspace/cli/tree/main/skills/gws-shared) — shared auth/flags/output conventions
- [openai/playwright](https://github.com/openai/skills/tree/main/skills/.curated/playwright) — проверка browser-based callbacks/consent

**P0 / SkillsMP**
- [oauth-integrator](https://skillsmp.com/skills/aretedriver-ai-skills-personas-api-oauth-integrator-skill-md) — OAuth implementation
- [webhook-expert](https://skillsmp.com/skills/willsigmon-sigstack-plugins-automation-skills-webhook-expert-skill-md) — webhook event handling
- [webhook-security](https://skillsmp.com/skills/vanman2024-ai-dev-marketplace-plugins-payments-skills-webhook-security-skill-md) — signature + replay hardening
- [integrating-stripe-webhooks](https://skillsmp.com/skills/pr-pm-prpm-claude-skills-integrating-stripe-webhooks-skill-md) — если Stripe-подобные flows часты

**Почему это подходит:** Этот профиль должен уметь не только ‘позвать API’, но и жить внутри auth/webhook/retry/idempotency reality.

## A09 — BuildAgent-DataMigration
**Keep:** Сохраняет F03/F04/F05/F07/F08/F13 + S11/S18/S27.

**P0 / GitHub**
- [supabase/postgres-best-practices](https://github.com/supabase/agent-skills/tree/main/skills/supabase-postgres-best-practices) — Postgres performance/RLS/schema patterns
- [neondatabase/neon-postgres](https://github.com/neondatabase/agent-skills/tree/main/skills/neon-postgres) — serverless Postgres guidance
- [tinybirdco/tinybird-best-practices](https://github.com/tinybirdco/tinybird-agent-skills/tree/main/skills/tinybird-best-practices) — SQL/data pipeline practices
- [ClickHouse/agent-skills](https://github.com/ClickHouse/agent-skills) — аналитический data stack

**P0 / SkillsMP**
- [database-migration](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-accolver-skill-maker-database-migration-skill-md) — safe reversible migrations with rollback/verification

**Почему это подходит:** Для migration-профиля критичны reversible plans, verification queries и zero-downtime discipline; этот набор именно про это.

## A10 — BuildAgent-InfraIaC
**Keep:** Сохраняет F03/F04/F05/F07/F08/F13 + S17/S27/S37.

**P0 / GitHub**
- [hashicorp/terraform-code-generation](https://github.com/hashicorp/agent-skills/tree/main/terraform/code-generation) — Terraform HCL generation/validation
- [hashicorp/terraform-module-generation](https://github.com/hashicorp/agent-skills/tree/main/terraform/module-generation) — Terraform module design
- [cloudflare/wrangler](https://github.com/cloudflare/skills/tree/main/skills/wrangler) — Workers/KV/R2/D1/Queues/Workflows ops
- [vercel/vercel-deploy-claimable](https://github.com/vercel-labs/agent-skills/tree/main/skills/claude.ai/vercel-deploy-claimable) — deployment workflow

**P0 / SkillsMP**
- [terraform-plan-validator-agent](https://skillsmp.com/skills/agentskillexchange-skills-skills-terraform-plan-validator-agent-skill-md) — plan validation via terraform/tfsec/Checkov
- [github-actions-cicd-pipeline-manager](https://skillsmp.com/skills/agentskillexchange-skills-skills-github-actions-cicd-pipeline-manager-skill-md) — создание/управление Actions pipelines
- [github-actions-workflow-debugger](https://skillsmp.com/skills/agentskillexchange-skills-skills-github-actions-workflow-debugger-4-skill-md) — debug failed CI/CD runs

**Почему это подходит:** InfraIaC у тебя должен быть golden-path oriented. Лучше всего работают Terraform + CI/CD validator skills, а не общие DevOps подсказки.

## A11 — TestAgent
**Keep:** Сохраняет F05/F06/F07/F13 + R03 + S19/S20/S21/S52.

**P0 / GitHub**
- [anthropics/webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) — локальное webapp testing через Playwright
- [openai/playwright](https://github.com/openai/skills/tree/main/skills/.curated/playwright) — browser automation
- [obra/test-driven-development](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) — TDD discipline
- [obra/verification-before-completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) — hard gate перед завершением
- [trailofbits/property-based-testing](https://github.com/trailofbits/skills/tree/main/plugins/property-based-testing) — property-based tests

**P0 / SkillsMP**
- [playwright-e2e-test-generator](https://skillsmp.com/skills/agentskillexchange-skills-skills-playwright-e2e-test-generator-skill-md) — генерация E2E suites
- [playwright-cli](https://skillsmp.com/skills/microsoft-playwright-packages-playwright-core-src-skill-skill-md) — если нужен CLI-level Playwright workflow

**Почему это подходит:** TestAgent у тебя должен строить proof-path, а не просто писать тесты. Поэтому TDD + browser automation + verification gate — лучшая тройка.

## A12 — ReviewAgent
**Keep:** Сохраняет F02/F05/F06/F07/F13 + S21/S22/S23.

**P0 / GitHub**
- [trailofbits/differential-review](https://github.com/trailofbits/skills/tree/main/plugins/differential-review) — security-aware diff review
- [getsentry/code-review](https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/code-review) — semantic code review
- [getsentry/find-bugs](https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/find-bugs) — bug hunting
- [trailofbits/fix-review](https://github.com/trailofbits/skills/tree/main/plugins/fix-review) — verify fix quality
- [openai/gh-address-comments](https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments) — address review feedback on GitHub PRs

**P0 / SkillsMP**
- [code-reviewer](https://skillsmp.com/skills/jeffallan-claude-skills-skills-code-reviewer-skill-md) — specialized code review report

**Почему это подходит:** ReviewAgent должен видеть diff свежими глазами и уметь замыкать loop в GitHub; именно это здесь покрыто.

## A13 — SecurityAgent
**Keep:** Сохраняет F02/F07/F08/F13 + S24/S25/S26/S49/S50/S51.

**P0 / GitHub**
- [openai/security-best-practices](https://github.com/openai/skills/tree/main/skills/.curated/security-best-practices) — language-specific vuln review
- [openai/security-threat-model](https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model) — trust boundaries/threat model
- [trailofbits/insecure-defaults](https://github.com/trailofbits/skills/tree/main/plugins/insecure-defaults) — fail-open / hardcoded secrets / weak defaults
- [trailofbits/static-analysis](https://github.com/trailofbits/skills/tree/main/plugins/static-analysis) — CodeQL/Semgrep/SARIF toolkit
- [trailofbits/differential-review](https://github.com/trailofbits/skills/tree/main/plugins/differential-review) — security-focused diff review
- [wrsmith108/varlock-claude-skill](https://github.com/wrsmith108/varlock-claude-skill) — strict env/secret handling

**P0 / SkillsMP**
- [tmdd-threat-modeling](https://skillsmp.com/skills/attasec-tmdd-agents-cursor-skill-skill-md) — threat-model first workflow
- [threat-modeling](https://skillsmp.com/skills/artifex1-auditor-addon-skills-threat-modeling-skill-md) — attack surface mapping
- [performing-oauth-scope-minimization-review](https://skillsmp.com/skills/autohandai-community-skills-performing-oauth-scope-minimization-review-skill-md) — OAuth least-privilege
- [webhook-security](https://skillsmp.com/skills/vanman2024-ai-dev-marketplace-plugins-payments-skills-webhook-security-skill-md) — signature/replay validation

**Почему это подходит:** SecurityAgent у тебя должен смотреть и код, и integration boundary, и secret hygiene. Здесь как раз закрыты all three.

## A14 — DocsAgent
**Keep:** Сохраняет F03/F06/F13 + R07 + S27/S28.

**P0 / GitHub**
- [anthropics/doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring) — collaborative docs
- [anthropics/internal-comms](https://github.com/anthropics/skills/tree/main/skills/internal-comms) — status reports / internal narratives
- [openai/doc](https://github.com/openai/skills/tree/main/skills/.curated/doc) — docx output
- [openai/pdf](https://github.com/openai/skills/tree/main/skills/.curated/pdf) — PDF read/write/review
- [google-labs-code/design-md](https://github.com/google-labs-code/stitch-skills/tree/main/skills/design-md) — design docs

**P0 / SkillsMP**
- [release-notes](https://skillsmp.com/skills/plutov-dotfiles-agentic-skills-release-notes-skill-md) — repo release notes
- [write-release-notes](https://skillsmp.com/skills/tldraw-tldraw-claude-skills-write-release-notes-skill-md) — human-readable release articles
- [changelog-generator](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-accolver-skill-maker-changelog-generator-skill-md) — audience-aware changelogs

**Почему это подходит:** DocsAgent должен уметь одинаково хорошо писать internal docs, release docs и artifact docs. Этот набор как раз об этом.

## A15 — ReleaseAgent
**Keep:** Сохраняет F05/F06/F07/F11/F13 + S28/S29/S30/S31/S54.

**P0 / GitHub**
- [openai/yeet](https://github.com/openai/skills/tree/main/skills/.curated/yeet) — stage/commit/push/PR workflow
- [openai/gh-fix-ci](https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci) — CI failure repair
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github) — PR/review/branching patterns
- [vercel/vercel-deploy-claimable](https://github.com/vercel-labs/agent-skills/tree/main/skills/claude.ai/vercel-deploy-claimable) — claimable deploy flow
- [cloudflare/wrangler](https://github.com/cloudflare/skills/tree/main/skills/wrangler) — Workers deployment/control

**P0 / SkillsMP**
- [release-notes](https://skillsmp.com/skills/plutov-dotfiles-agentic-skills-release-notes-skill-md) — release summary generation
- [release](https://skillsmp.com/skills/ngagne-copilot-agent-skills-github-skills-release-skill-md) — release housekeeping workflow
- [prepare-release](https://skillsmp.com/skills/cherryhq-cherry-studio-agents-skills-prepare-release-skill-md) — semver/version bump prep
- [github-actions-cicd-pipeline-manager](https://skillsmp.com/skills/agentskillexchange-skills-skills-github-actions-cicd-pipeline-manager-skill-md) — if release gates are GitHub Actions-heavy

**Почему это подходит:** ReleaseAgent у тебя должен уметь пройти путь merge gate → deploy → smoke → rollback note. Здесь собраны именно эти переходы.

## A16 — MonitoringAgent
**Keep:** Сохраняет F06/F07/F11/F13 + S32/S33/S34/S35/S54.

**P0 / GitHub**
- [openai/sentry](https://github.com/openai/skills/tree/main/skills/.curated/sentry) — Sentry issue inspection
- [getsentry/find-bugs](https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/find-bugs) — production bug hunting
- [cloudflare/web-perf](https://github.com/cloudflare/skills/tree/main/skills/web-perf) — web performance/latency regressions

**P0 / SkillsMP**
- [observability](https://skillsmp.com/skills/tswr-engineering-mastery-plugin-skills-observability-skill-md) — logging/metrics/tracing/alerting
- [api-observability-baseline](https://skillsmp.com/skills/andcast77-multisystem-cursor-skills-api-observability-baseline-skill-md) — minimum controls for API changes
- [agent-observability](https://skillsmp.com/skills/ollim-ai-ollim-bot-claude-skills-agent-observability-skill-md) — agent/runtime traceability
- [debugging-with-sentry](https://skillsmp.com/skills/b4rz99-fidy-claude-skills-debugging-with-sentry-skill-md) — Sentry-driven debugging
- [sentry-incident-runbook](https://skillsmp.com/skills/jeremylongshore-claude-code-plugins-plus-skills-plugins-saas-packs-sentry-pack-skills-sentry-incident-runbook-skill-md) — incident triage/playbook

**Почему это подходит:** MonitoringAgent у тебя — post-deploy health + incident triage. Без observability baseline и Sentry runbooks он будет слишком слепым.

## A17 — ProvisionerAgent
**Keep:** Сохраняет F03/F08/F10 + R04/R10 + S36/S37/S38.

**P0 / GitHub**
- [anthropics/mcp-builder](https://github.com/anthropics/skills/tree/main/skills/mcp-builder) — создание MCP servers
- [cloudflare/building-mcp-server-on-cloudflare](https://github.com/cloudflare/skills/tree/main/skills/building-mcp-server-on-cloudflare) — remote MCP on Cloudflare
- [cloudflare/agents-sdk](https://github.com/cloudflare/skills/tree/main/skills/agents-sdk) — agent platform primitives
- [getsentry/agents-md](https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/agents-md) — bootstrap AGENTS.md
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github) — repo workflow conventions

**P0 / SkillsMP**
- [mcp-builder](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-ederheisler-agent-skills-mcp-builder-skill-md) — MCP skill scaffold + eval mindset
- [mcp-server-patterns](https://skillsmp.com/skills/tatematsu-k-ai-development-skills-plugins-ecc-skills-mcp-server-patterns-skill-md) — MCP server design patterns
- [sqlite-mcp-server](https://skillsmp.com/skills/agentskillexchange-skills-skills-sqlite-mcp-server-skill-md) — ready reference for local data MCP
- [github-actions-cicd-pipeline-manager](https://skillsmp.com/skills/agentskillexchange-skills-skills-github-actions-cicd-pipeline-manager-skill-md) — bootstrap CI/CD with reusable workflows

**Почему это подходит:** ProvisionerAgent у тебя отвечает за golden path. Поэтому сюда лучше класть scaffolding + MCP + workflow bootstrap skills.

## A18 — DependencyAgent
**Keep:** Сохраняет F04/F05/F06/F07 + S26/S39/S40.

**P0 / GitHub**
- [stripe/upgrade-stripe](https://github.com/stripe/ai/tree/main/skills/upgrade-stripe) — SDK/API version upgrade flow
- [vercel/next-upgrade](https://github.com/vercel-labs/next-skills/tree/main/skills/next-upgrade) — Next.js upgrades
- [callstackincubator/upgrading-react-native](https://github.com/callstackincubator/agent-skills/tree/main/skills/upgrading-react-native) — React Native upgrade workflow
- [openai/gh-fix-ci](https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci) — repair broken upgrade PR checks

**P0 / SkillsMP**
- [dependency-update](https://skillsmp.com/skills/microsoft-aspire-github-skills-dependency-update-skill-md) — structured dependency update workflow
- [sdk-version-checker](https://skillsmp.com/skills/agentskillexchange-skills-skills-sdk-version-checker-skill-md) — audit SDK versions and upgrade paths
- [dependency-auditor](https://skillsmp.com/skills/levalencia-agent-god-mode-organized-skills-dependency-auditor-skill-md) — dependency risk posture
- [changelog-generator](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-accolver-skill-maker-changelog-generator-skill-md) — breaking changes / migration notes after upgrades

**Почему это подходит:** DependencyAgent должен не просто bump version, а понимать semver risk, CI fallout и migration communication.

## A19 — EvalsAgent
**Keep:** Сохраняет F12 + R02 + S41/S42/S45.

**P0 / GitHub**
- [anthropics/skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) — создание и эволюция навыков
- [muratcankoylan/evaluation](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/evaluation) — evaluation frameworks for agent systems
- [ShunsukeHayashi/agent-skill-bus](https://github.com/ShunsukeHayashi/agent-skill-bus) — runtime monitoring/self-improvement loop

**P0 / SkillsMP**
- [agent-evaluation](https://skillsmp.com/skills/autohandai-community-skills-agent-evaluation-skill-md) — agent eval design
- [llm-evaluation](https://skillsmp.com/skills/wshobson-agents-plugins-llm-application-dev-skills-llm-evaluation-skill-md) — LLM app quality benchmarks
- [evaluation-methodology](https://skillsmp.com/skills/doanchienthangdev-omgkit-plugin-skills-ai-engineering-evaluation-methodology-skill-md) — eval methods catalog

**Почему это подходит:** EvalsAgent у тебя нужен рано, чтобы skill zoo не стал хаотичным. Этот набор помогает и строить evals, и закрывать feedback loop по качеству.

## A20 — ReporterAgent
**Keep:** Сохраняет F06/F09/F13 + S03/S43/S44.

**P0 / GitHub**
- [anthropics/internal-comms](https://github.com/anthropics/skills/tree/main/skills/internal-comms) — status updates / FAQs / summaries
- [openai/linear](https://github.com/openai/skills/tree/main/skills/.curated/linear) — операции в Linear
- [openai/gh-address-comments](https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments) — ответы на review/comments
- [openai/doc](https://github.com/openai/skills/tree/main/skills/.curated/doc) — если нужен вывод summary в docx

**P0 / SkillsMP**
- [linear](https://skillsmp.com/skills/lobehub-lobehub-agents-skills-linear-skill-md) — Linear integration surface
- [linear-cli](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-rolaca11-linear-cli-linear-cli-skill-md) — CLI-oriented Linear ops
- [release-notes](https://skillsmp.com/skills/plutov-dotfiles-agentic-skills-release-notes-skill-md) — человеко-читаемые summaries для релизов

**P1 / optional**
- [googleworkspace/gws-docs](https://github.com/googleworkspace/cli/tree/main/skills/gws-docs) — если захочешь дублировать human-facing summaries в Google Docs
- [googleworkspace/gws-gmail](https://github.com/googleworkspace/cli/tree/main/skills/gws-gmail) — если Reporter будет слать email digests
- [googleworkspace/gws-calendar](https://github.com/googleworkspace/cli/tree/main/skills/gws-calendar) — если нужен meeting/status workflow

**Почему это подходит:** ReporterAgent у тебя — human-readable слой системы. Ему полезнее всего internal-comms + Linear + review-comment handling.


## Что бы я поставил в первую волну без обсуждений

### 1) Для control plane
- [openai/linear](https://github.com/openai/skills/tree/main/skills/.curated/linear)
- [callstackincubator/github](https://github.com/callstackincubator/agent-skills/tree/main/skills/github)
- [triage-agent](https://skillsmp.com/skills/neversight-learn-skills-dev-data-skills-md-vishal2457-open-orchestra-triage-agent-skill-md)
- [trailofbits/audit-context-building](https://github.com/trailofbits/skills/tree/main/plugins/audit-context-building)
- [muratcankoylan/memory-systems](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/memory-systems)

### 2) Для spec / architecture / planning
- [anthropics/doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring)
- [NeoLabHQ/sdd](https://github.com/NeoLabHQ/context-engineering-kit/tree/master/plugins/sdd)
- [spec-driven-development](https://skillsmp.com/skills/jasonkneen-kiro-skills-spec-driven-development-skill-md)
- [create-adr](https://skillsmp.com/skills/majesticlabs-dev-majestic-marketplace-plugins-majestic-engineer-skills-create-adr-skill-md)

### 3) Для review / security / testing
- [anthropics/webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- [trailofbits/differential-review](https://github.com/trailofbits/skills/tree/main/plugins/differential-review)
- [trailofbits/insecure-defaults](https://github.com/trailofbits/skills/tree/main/plugins/insecure-defaults)
- [openai/security-threat-model](https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model)
- [getsentry/find-bugs](https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/find-bugs)

### 4) Для integration / release / monitoring
- [ComposioHQ/skills](https://github.com/ComposioHQ/skills)
- [oauth-integrator](https://skillsmp.com/skills/aretedriver-ai-skills-personas-api-oauth-integrator-skill-md)
- [webhook-security](https://skillsmp.com/skills/vanman2024-ai-dev-marketplace-plugins-payments-skills-webhook-security-skill-md)
- [github-actions-cicd-pipeline-manager](https://skillsmp.com/skills/agentskillexchange-skills-skills-github-actions-cicd-pipeline-manager-skill-md)
- [openai/sentry](https://github.com/openai/skills/tree/main/skills/.curated/sentry)

## Где я бы **не** заменял custom skills

Даже после этой внешней подпитки я бы **не выносил наружу** следующие твои custom skills:
- F07 Risk Escalation & Human Gate
- F08 Secrets, Permissions & Safe Command Guard
- F09 Decision Log & Memory Skill
- F10 Repo/Project Registry Resolver
- F11 Telemetry & Artifact Linker
- F13 Sensitive Auth Data Boundary Guard
- S46–S54 весь integration control-plane пакет

Причина простая: это не generic skills, а **твой operating model**.

## Итог

Если совсем коротко:
- твой v2 уже хорошо описывает **роли и внутренние кастомные навыки**,
- извне надо добавить не “ещё сто общих skills”, а **точечные external bundles**,
- самые недостающие усиления сейчас: **Linear/GitHub orchestration**, **spec-driven workflow**, **review/security/testing**, **OAuth/webhook/integration readiness**, **observability/evals**.
