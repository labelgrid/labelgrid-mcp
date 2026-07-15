# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in `@labelgrid/mcp`, please report it privately to **security@labelgrid.com**. We will acknowledge your report and work with you on a fix.

Please do **not**:

- open a public GitHub issue for a security vulnerability, or
- include any secrets (API tokens, credentials) in your report or in any issue, PR, or log you attach.

If you need to share a reproduction that involves a token, redact it — we can reproduce with our own test credentials.

## Supported versions

Security fixes are provided for the latest released `0.x` line.

| Version | Supported |
| --- | --- |
| 0.x (latest) | ✅ |
| older 0.x | ❌ |

## Handling your credentials

- Your `LABELGRID_API_TOKEN` is read from the environment only. It is never written to disk, logged, or included in any tool output.
- All diagnostic logging goes to stderr and passes through a secret-redaction step; the MCP protocol stream (stdout) never carries logs.
- Revoke a token at any time from **Profile → API Tokens** in your dashboard, or with the `revoke_api_token` tool.
