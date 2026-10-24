# Project-Specific Agent Rules

Files in this `.agents.md/project/` directory hold instructions that are **specific to this
project** — its stack, domain rules, conventions, or anything that should not live in the
shared/global rule set.

- **`arc-agents-md update` never touches this directory.** Edit freely; updates won't clobber it.
- Reference these files from `AGENTS.md` (add a row to the task-conditional loading table,
  or a note below the managed block) so agents know when to load them.

## Suggested files

Create only what you need — nothing speculative.

- `stack.md` — languages, frameworks, package manager, build/test commands
- `conventions.md` — naming, folder layout, commit style specific to this repo
- `domain.md` — business/domain rules an agent must respect

Delete this README once you've added your own files.
