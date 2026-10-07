# ghorgs-of/qadence-tessel state record

This directory adopts the semantic registry path used by
[`ghorgs-of/walrus-man`](https://github.com/ghorgs-of/walrus-man). It is a
state-record placeholder for this Codex thread, not a nested checkout and not
a claim of GitHub ownership or administrative authority.

## Identity and custody

- agent card: `🎼2♣️⬇️`
- default semantic agent slug: `ghorgs-of/qadence-tessel`
- current GitHub repository: `BESTIARY-OF/tdotdh-v2`
- local checkout: `C:/Users/victorb/.codex/visualizations/2026/07/31/019fb767-2db0-71f2-bf8f-3cf52d2fde4a/tdotdh-v2-monorepo`
- branch: `main`
- origin: `https://github.com/BESTIARY-OF/tdotdh-v2.git`
- local worktree at record time: dirty only in unrelated `docs/card-agent-roster.md`
- remote mutation: not authorized or performed by this record

The actual checkout remains at the local path above. This nested path is only
the durable semantic record requested for the thread.

## Repo-state classification

Observed locally before writing this record:

```text
S1 checkout-discovered: confirmed
S2 remote-classified: existing-repo (origin is present)
S3 branch-classified: existing local main branch; upstream relation observed
S4 fetch-classified: not re-run for this record
S5 quest-ready: not asserted for a remote mutation
S6 mutation-authorized: no
```

The record follows the conservative `resolve -> inspect -> classify -> claim ->
mutate -> verify -> record -> handoff` ritual. Unknown or unmeasured state is
left explicit rather than inferred.

## Installed-skill provenance ledger

The rule for this workspace is: update an upstream skill repository only when
the installed skill has direct, verifiable provenance to that repository. A
skill name alone is not evidence of an upstream remote.

| Installed skill | Installed location | Provenance observed | Action |
| --- | --- | --- | --- |
| `image-orientation-awareness` | `C:/Users/victorb/.agents/skills/image-orientation-awareness` | Local skill directory; no `.git` directory or `skill-of/foo` remote discovered | No remote update claimed |
| `skill-creator` | `C:/Users/victorb/.codex/skills/.system/skill-creator` | System-owned install; no user-repository remote discovered | Used locally; no upstream mutation |
| `browser/control-in-app-browser` | `C:/Users/victorb/.codex/plugins/cache/openai-bundled/browser/26.803.41515/skills/control-in-app-browser` | Bundled plugin cache; no user-repository remote discovered | Used locally; no upstream mutation |

The prior orientation-awareness change therefore remains a local skill change;
there is no evidence-based `skill-of/foo` checkout or remote to update from
this workspace.

## Handoff

```text
from-agent: current Codex thread / 🎼2♣️⬇️
to-agent: unknown
scope: ghorgs-of/qadence-tessel / BESTIARY-OF/tdotdh-v2 / main / local checkout
state: accepted
evidence: this file plus git status, remote, branch, and installed-skill checks
next-condition: classify any requested remote mutation explicitly before acting
```
