# SOC-016 integrated release

On 2026-10-19 the owner requested publication and deployment of pending local
work. This candidate integrates Reach/source/provider-session changes onto the
current SOC-019 main, preserving the SOC-018 immutable media cache and SOC-019
repair code. The original AGENTS.md remains in place; local browser profiles,
Playwright captures, cookies, logs and private source exports are excluded.

Strict TypeScript and 70 synthetic tests passed on the integrated candidate.
The frozen existing dependency lock is retained; no dependency upgrade is part
of this delivery. npm audit reports existing dependency vulnerabilities (10
critical, 57 high, 98 moderate, 3 low); this release does not claim remediation
or expose the worker/n8n publicly.

All included account workflows stay manual and inactive. Source delivery does
not submit a post, activate a schedule, migrate login profiles or certify live
selectors. Current local runtime activation is a separate health/version check.
