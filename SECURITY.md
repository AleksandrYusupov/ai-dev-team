# Security Policy

## Supported Status

This repository is experimental. Public code and docs are provided for review and collaboration, not as a turnkey hosted service.

## Reporting A Vulnerability

Open a private security advisory on GitHub if available for the repository, or contact the maintainer privately. Do not publish exploit details or leaked credentials in public issues.

## Secret Handling Rules

Never commit:

- `.env` or `.env.local`;
- API keys or personal access tokens;
- Linear or GitHub webhook signing secrets;
- runner bearer tokens;
- OAuth client secrets, authorization codes, access tokens, or refresh tokens;
- private keys or certificates;
- browser session dumps;
- personal vault paths or private workspace URLs.

Committed files may contain placeholders only. Real values belong in local ignored env files, shell exports, GitHub Actions secrets, or deployment secret managers.

## Webhook And OAuth Rules

- Verify webhook signatures before accepting provider events.
- Use replay protection where provider payloads support timestamps or delivery ids.
- Store OAuth callback metadata only. Raw authorization codes and tokens must be exchanged and stored behind a broker or secret manager boundary.
- Rotate webhook secrets by overlapping old and new values only for the shortest provider-supported validation window.

## Credential Rotation Before Public Release

Before pushing a sanitized public repository:

1. Rotate any value that appeared in `.env`, `.env.local`, terminal logs, generated artifacts, or a publish candidate.
2. Recreate Linear and GitHub webhook secrets.
3. Recreate runner bearer tokens and internal API bearer tokens.
4. Revoke unused personal access tokens.
5. Confirm the public tree contains no raw secrets with local scans and GitHub push protection.

## GitHub Repository Hardening

For the public GitHub repository:

- enable secret scanning and push protection where available;
- keep GitHub Actions `GITHUB_TOKEN` permissions restricted;
- enable Dependabot alerts and dependency updates;
- require CI checks on the default branch;
- protect the default branch from direct pushes.
