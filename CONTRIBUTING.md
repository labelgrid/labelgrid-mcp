# Contributing

## Issue tracking

GitHub Issues are LabelGrid MCP's public intake and discussion channel for bug reports
and feature requests. They are not the internal engineering backlog.

LabelGrid maintainers track accepted work, internal planning, and implementation in the
private Jira DEV project. Maintainers may mirror a public report into Jira during triage.
Internal-only engineering tasks must be created in Jira, not GitHub.

Before opening a GitHub issue:

- search existing issues for the same report;
- include the MCP or CLI version, client, operating system, and reproduction steps;
- remove API tokens, credentials, account data, and other private information.

Security vulnerabilities do not belong in public issues. Follow
[`SECURITY.md`](./SECURITY.md) and report them privately to `security@labelgrid.com`.

## Pull requests

Pull requests are welcome. Keep changes focused and preserve the thin-wrapper design:
API validation and business rules belong on the LabelGrid server.

Run the repository checks before submission:

```bash
npm ci
npm run build
npm test
npm run lint
npm run leak-guard
```

Changes to MCP tool descriptions must be made in `packages/mcp/src/tools/`; regenerate
the README tool table with `npm run gen-docs`.
