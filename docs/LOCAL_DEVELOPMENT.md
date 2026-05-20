# Local Development

## Prerequisites

- Node.js 22 or newer
- Corepack and pnpm
- Docker

Enable Corepack and install dependencies:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

Create local configuration:

```bash
cp .env.example .env.local
```

Replace placeholder secrets in `.env.local` with locally generated values. Do not commit `.env.local`.

## Start Local Infrastructure

```bash
corepack pnpm infra:up
```

This starts local Postgres and Temporal. Apply migrations and validate config:

```bash
corepack pnpm db:migrate
corepack pnpm db:validate-workflow-config
corepack pnpm db:validate-agent-config
corepack pnpm db:validate-agent-standards
```

## Run Services

In separate terminals:

```bash
corepack pnpm dev:control-api
corepack pnpm dev:workflow-worker
corepack pnpm dev:outbox-executor
```

Optional local knowledge snapshotting requires a local vault path in `KNOWLEDGE_SYNC_VAULT_ROOT`:

```bash
corepack pnpm dev:knowledge-sync
```

## Runner Host

For fake runner smoke checks:

```bash
corepack pnpm dev:fake-runner
corepack pnpm test:phase6
```

For live provider-backed runner experiments, configure local provider CLI sessions first, then run:

```bash
corepack pnpm dev:runner-host:codex
corepack pnpm dev:runner-host:claude
```

Live runner use is intentionally local and trusted. Do not put provider tokens or session dumps in repo files.

## Test Commands

Fast checks:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Build:

```bash
corepack pnpm build
```

Integration tests require local Postgres and Temporal:

```bash
corepack pnpm test:integration
```

## Cleanup

```bash
corepack pnpm infra:down
```

Generated outputs live under `dist/` and are ignored by Git.
