# OmniSocial

Manually started orchestration for distributing approved portfolio blog posts to
the owner's configured social accounts, with verified publication receipts and
recoverable execution records.

The feasibility report and local dry-run foundation are under draft review.
Account connections and social publishing remain disabled.

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

V1 covers TikTok Personal, TikTok Business, X, Reddit, Pinterest Business, and
Pinterest Personal. Each destination has its own feasibility gate and verified
delivery record. A manually started run does not imply that every platform allows
website scripting or supports every media operation.

V2 social research, reviewed engagement, and daily or weekly editorial summaries
remain deferred. No schedule, workflow execution, account connection, deployment,
or external social action is included in SOC-001.
