---
name: mr-description
description: Write a factual English OmniSocial pull request description.
---

# PR Description

Read AGENTS.md, the milestone, committed diff against the actual remote base,
and validation output. Preserve earlier unrelated work. Write English Markdown
to ignored `tmp/mr-description.md` with real newlines. For CLI fallback use
`--body-file`, not escaped command-line prose.

Use a title such as `[SOC-001] Define v1 implementation plan`. Include Background,
Solution, Testing / QA, Security and privacy, Known follow-ups, Scope of changes,
and the exact related ticket. Scale detail to the actual diff. No em dashes.

Lead with the problem and resulting behavior. Do not include conversational
history, invented tests, unsupported provider status, secrets, or memory citations.
Document-only changes have no visual/product/runtime changes. Explicitly identify
unrun checks and pending approvals. A source observation or draft PR does not
prove deployment, platform access, or external publication.
