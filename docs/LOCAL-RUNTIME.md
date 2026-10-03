# Local runtime: SOC-003

This is a local dry-run foundation. It has no prepare, publish, browser-navigation,
portfolio-write or schedule operations. The worker currently exposes only an
authenticated health operation. Account sessions remain unconnected.

## Pinned distribution

- Node.js `24.21.0`, already installed on the development Mac.
- n8n Community Edition `2.41.6`, official stable npm distribution checked on
  2026-10-03 against registry metadata and the upstream release.
- Playwright `1.63.0`; use its bundled Chromium, not daily Chrome.
- Bundled Chromium observed at `153.0.8010.12` in a successful empty headless launch.
- SQLite via Node's built-in `node:sqlite`, tied to the Node pin.
- Exact dependency resolution and integrity are recorded in `package-lock.json`.

Docker CLI exists, but its daemon was unavailable. The supported n8n 2.x npm
distribution avoids installing the development monorepo or starting unrelated
Docker workloads. Reassess distribution support before upgrading n8n to 3.x.
No cloud subscription or paid license is needed for this foundation. Community
Edition workflow versioning uses sanitized Git exports, not paid source control.
The current official installation guide deprecates npm from n8n 3.0; this pin
is 2.x. Container migration is required before that upgrade.

## Install and start manually

```sh
npm ci
npm run setup:local
npm exec playwright install chromium
npm run start:worker
```

In another terminal:

```sh
npm run start:n8n
```

Open `http://localhost:5678` and create the local n8n owner account directly in
the browser. Do not send passwords or MFA to chat. This owner setup is separate
from social-platform login and does not enable publication. The launcher binds
the editor to loopback. Do not expose it through port forwarding or tunnels.
Stop each terminal with Ctrl+C. There is no launch agent, scheduler or autostart.
The installed npm `12.0.2` blocks dependency install scripts by default. The
project allows only pinned `sqlite3@5.1.7` and `isolated-vm@7.0.1` native builds
needed by n8n; initial native dependencies were rebuilt with this policy.
Other optional provider/profiling scripts remain blocked. Their adapters are
not validated or enabled. Do not approve every install script to clear warnings.

The secure-cookie setting uses `localhost`; use that hostname for the editor.
The worker listens on `127.0.0.1:8787`. Requests need the protected local bearer
token and exact loopback Host header; browser Origin requests are rejected.
Only `GET /v1/health` exists. Unknown routes and all write methods are refused.
An unavailable journal returns a handled error, independent of n8n Error Trigger.

## Protected state

`setup:local` uses owner-only directories (0700) and generates independent secrets
as owner-only files (0600), without displaying or rotating existing values.
It rejects unsafe directory symlinks and improperly protected secret files.

| Ignored path | Purpose |
| --- | --- |
| `.secrets/worker-token` | Local HTTP bearer credential; never place in workflow JSON |
| `.secrets/n8n-encryption-key` | n8n credential encryption key; preserve with protected backups |
| `runtime/n8n/` | Dedicated n8n internal data, independent of any other n8n installation |
| `runtime/journal.sqlite` | WAL + FULL synchronous local schema foundation |
| `runtime/media/`, `runtime/reports/` | Future local evidence and media; no cleanup automation yet |
| `profiles/portfolio` | Future dedicated source session |
| `profiles/<target>` | Six separate future platform sessions, in the configured processing order |

Playwright profile files are not encrypted by Playwright. FileVault was observed
enabled on this Mac on 2026-10-03. Recheck disk encryption on another host.
Profiles are currently empty; directories do not prove successful login.
Browser login/profile launch and identity validation are pending implementation.

The journal currently stores only schema metadata. Synthetic reopen checks prove
SQLite persistence, not durable publication attempts, receipts, fencing or sync.
Those belong to SOC-005. Health always returns `publishingEnabled: false` and
`sourceConnected: false`; neither flag can be enabled by request parameters.

The n8n launcher disables public API, community packages, diagnostics, templates,
environment access in nodes, shell and file nodes, and saved execution payloads.
It supplies only the required environment to the child process. Credentials and
workflow access still require local owner setup. Do not import unreviewed nodes
or workflows. No workflows are imported or active in this milestone.

## Validation

`npm test` uses temporary synthetic SQLite data and a loopback test server. It
checks reopen persistence, separate synthetic account rows, private database
permissions, missing authorization, foreign Host, browser Origin, absent side
effect operations and explicit journal-failure responses. Test records are
deleted from their temporary directory after each run.

Before accepting SOC-003, verify installed versions, local service readiness,
loopback listeners, ignored secret/runtime files and local owner setup. Actual
account login, n8n-to-worker credentials/integration, browser identity checks and
full submission/replay behavior remain pending. No real pilot is authorized by
starting these local services.

### Observed setup receipts on 2026-10-03

Installed exact versions match the pins. Native rebuild succeeded after initial
startup exposed npm's blocked SQLite install. Both synthetic runtime tests passed.
An authenticated request to the running worker returned HTTP 200, dry-run mode,
publication disabled and source disconnected. The n8n health endpoint returned
HTTP 200 after database migrations. Listener inspection showed loopback-only
ports 5678, 5679 (n8n task broker) and 8787. The UI displayed the local owner setup
form. No owner password was entered and no workflow was imported or activated.

n8n's internal JS runner started; its optional Python runner reported a missing
virtual environment. No Python or Code-node workflow was tested. Internal runner
mode also has an upstream deprecation warning. This foundation uses no Code
nodes; external runners/container isolation need their own validation before
adding such workflows. Health and blank Chromium launch do not prove workflow
integration, account identity or publication recovery.

SOC-003 is reserved after a fresh all-ref audit found SOC-002 as the highest Git
ticket and no collision. Delivery is stacked on SOC-002, which remains a draft
dependent on SOC-001. SOC-004 becomes the next allocation candidate after the
SOC-003 commit; its roadmap entry remains a proposal until audited and started.

## Primary sources

- [n8n 2.41.6 release](https://github.com/n8n-io/n8n/releases/tag/n8n%402.41.6).
- [Official npm installation](https://docs.n8n.io/deploy/host-n8n/install-options/install-with-npm.md).
- [Deployment settings](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/deployment.md).
- [Security settings](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/security.md).
- [Playwright persistent profiles](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).
