# OmniSocial

Owner-authorized local automation for distributing eligible portfolio blog posts
to the configured social accounts, with verified publication receipts and
recoverable execution records.

The daily 17:00 Europe/Bucharest Codex heartbeat is active under SOC-017. Its
configuration is not evidence that account sessions, provider transports, or
publications have been verified in a scheduled run.

Initial milestone: SOC-001.

## Project documents

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): complete V1 flow, milestones,
  n8n build instructions, platform decisions, recovery, and acceptance criteria.
- [Agent rules](AGENTS.md): scope, evidence, credentials, milestone numbering,
  commit, push, and pull request conventions.
- [Publishing workflow](.codex/skills/publish/SKILL.md): the delivery procedure.
- [Feasibility report](docs/SOC-002-FEASIBILITY.md): source contract and six-account gates.
- [Local runtime](docs/LOCAL-RUNTIME.md): pinned setup, protection and manual startup.
- [Dry-run manifests](docs/SOC-004-DRY-RUN.md): fixture planner, manual n8n flow and live-source gates.
- [Durable operations](docs/SOC-005-OPERATIONS.md): protected approvals, leases, media validation and recovery.

V1 covers TikTok Personal, TikTok Business, X, Reddit, Pinterest Business, and
Pinterest Personal. Each destination has its own feasibility gate and verified
delivery record. A manually started run does not imply that every platform allows
website scripting or supports every media operation.

V2 social research, reviewed engagement, and daily or weekly editorial summaries
remain deferred. SOC-001 itself does not include a schedule, workflow execution,
account connection, deployment, or external social action; scheduled publishing
is separately authorized and tracked under SOC-017.

## Live browser implementation

The manual Playwright runner and n8n entry points are documented in
[SOC-015](docs/SOC-015-PLAYWRIGHT.md). Reach pack flows are tracked in
[SOC-016](docs/SOC-016-REACH-PACKS.md). Login, UI calibration, portfolio readback
release and an approved live pilot remain separate from fixture validation.
