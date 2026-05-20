# Agent Changelog Template

Use this file as a public-safe template for implementation audit entries. Keep real
project-local audit logs outside published artifacts when they include private
workspace names, local paths, credentials, customer details, or operational URLs.

## Entry Format

```md
## YYYY-MM-DD - Short task title

- Intent: What changed and why.
- Files changed: Public-safe list of changed paths.
- Commands/tests run: Exact local commands or `not run` with reason.
- Docs updated: Public docs or internal notes updated.
- Tooling notes: Context7, Serena, Sequential Thinking, or other MCP outputs that
  influenced decisions.
- Risks/follow-ups: Remaining migration, security, or verification work.
```

## Rules

- Never paste secrets, webhook payloads, OAuth callback credentials, bearer
  tokens, private keys, or environment file values into changelog entries.
- Replace private hostnames, local user directories, vault paths, and vendor
  workspace names with placeholders.
- Keep changelog entries append-only after publication unless a security cleanup
  requires removing accidentally exposed private data before the first public
  commit.
