# AGENTS.md

Repository-level guidance for AI agents working in this project.

## Instruction Hierarchy

Apply instructions in this order:

1. system
2. project
3. repository
4. agent/runtime
5. provider

Lower layers may add constraints but must not weaken higher layers.

## Architecture First

- Read the relevant architecture and runbook docs before changing code.
- Treat `config/workflow`, `config/agents`, and `config/agent-standards` as source-of-truth config surfaces.
- Keep changes small and aligned with the existing package ownership.
- Do not introduce new dependencies or abstractions unless they are required for the task.

## Public-Repo Security Rules

- Never commit real `.env` files, API keys, webhook secrets, OAuth credentials, runner bearer tokens, private keys, local vault paths, browser sessions, or provider-console exports.
- Use `.env.example` only for placeholders and local-safe defaults.
- Raw secrets, OAuth codes, access tokens, and refresh tokens must not be stored in repo docs, prompt bundles, context packs, artifacts, or tests.
- Local agent state such as `.claude`, `.codex`, `.serena`, `node_modules`, `dist`, runner worktrees, and managed skill caches must stay untracked.

## Code Ownership

- `apps/control-api`: HTTP routes, webhook ingress, internal inspection, runner-host transport, and knowledge/context reads.
- `apps/workflow-worker`: Temporal workflows, inbox/outbox processing, lifecycle orchestration, and Linear writeback.
- `apps/runner-host`: trusted local runner runtime, provider adapters, MCP pool, worktrees, artifacts, and fake runner smoke paths.
- `packages/db`: schema, migrations, config validation/publishing, runtime persistence helpers.
- `packages/shared`: DTOs, enums, and versioned cross-package contracts.
- `packages/config`: environment parsing and typed runtime configuration.

## Tooling And Documentation

- Use Context7 before changing logic that depends on external libraries or frameworks.
- Prefer structured code navigation tools when available; otherwise use `rg` and targeted file reads.
- Update public repo docs when behavior, configuration, security posture, or local setup changes.
- If private Obsidian notes are used as source material, publish only sanitized summaries into this repository.
- Record meaningful implementation changes in `04_AGENT_CHANGELOG.md`.

## Verification

Run the fastest relevant checks first:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

For broader changes:

```bash
corepack pnpm build
corepack pnpm test:integration
corepack pnpm test:phase6
```

Integration tests require local Postgres/Temporal and a configured `DATABASE_URL`.
