# LLM Wiki — OKF Hybrid System (Memory Directory)

This file applies **only when the project has a `memory/` directory at its root.** If no such directory exists, skip this file entirely.

The root-level `memory/` directory is the project's LLM Wiki — curated, high-signal context for both humans and AI agents. Treat it as the source of truth for architecture, decisions, and domain knowledge.

This system is a **hybrid**: it keeps a clean, fixed 5-file categorical structure, and layers **Open Knowledge Format (OKF)** YAML frontmatter on top so external AI agents, indexers, and tooling can parse each file's metadata programmatically. The human-readable structure and the machine-readable metadata are both mandatory.

---

## Frontmatter Standard (Mandatory)

**Every file in `memory/` MUST begin with an OKF-compliant YAML frontmatter block.** No exceptions.

- The frontmatter block is the **first content in the file** — line 1 is `---`, with no blank lines or characters before it.
- The block is delimited by `---` on its own line above and below.
- All four fields defined below are **required**. A file missing any field, or missing the block entirely, is non-compliant and must be corrected before any other edit.
- Frontmatter values must be accurate. If you edit a file's body, you MUST update its `last_updated` field in the same change.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `type` | enum | Machine-readable category. One of: `architecture-reference`, `decision-log`, `pattern-registry`, `pitfall-registry`, `domain-glossary`. |
| `title` | string | A concise, human-readable title for the file. |
| `description` | string | A one-sentence summary of what this file tracks. |
| `last_updated` | date | The date of the most recent edit, in `YYYY-MM-DD` format. |

---

## File Conventions

The directory contains exactly these five files. Each file maps to exactly one `type`. Do not add, rename, or split these files.

| File | `type` | Purpose |
|---|---|---|
| `memory/architecture.md` | `architecture-reference` | System design and invariants |
| `memory/decisions.md` | `decision-log` | ADR-style decisions |
| `memory/patterns.md` | `pattern-registry` | Reusable patterns and anti-patterns |
| `memory/gotchas.md` | `pitfall-registry` | Pitfalls and edge cases |
| `memory/domain.md` | `domain-glossary` | Domain concepts and terminology |

---

## Code Example

An exact snapshot of how `memory/gotchas.md` must look with its OKF frontmatter attached:

```markdown
---
type: pitfall-registry
title: Gotchas & Edge Cases
description: Non-obvious pitfalls, edge cases, and traps discovered while working in this codebase.
last_updated: 2026-07-02
---

# Gotchas

## Auth tokens expire silently after 15 minutes
The refresh flow does not fire on background tabs. Any long-running
request must re-check token validity before sending, or it fails with
a misleading 500 instead of a 401.

## `parseConfig()` mutates its input
It normalizes the object in place. Clone before passing shared config,
or downstream readers see the mutated version.
```

---

## When to Read

- At the start of any task, to understand context
- Before making architectural or design changes
- When encountering unfamiliar parts of the codebase

Read the frontmatter `type` and `description` first to decide relevance, then load only the files relevant to the current task. Do not pre-load all wiki files.

## When to Write or Update

- After making non-trivial changes
- When introducing new patterns or conventions
- When discovering important gotchas or edge cases
- When making architectural decisions

Every write MUST refresh the affected file's `last_updated` field.

## How to Write

- Prefer updating existing files over creating new ones
- Keep entries concise, explicit, and unambiguous
- Avoid duplication and stale information
- Do NOT store raw logs, transcripts, or temporary notes
- Focus on distilled knowledge: decisions, patterns, invariants
- Never break or omit the frontmatter block when editing

## Constraints

- All memory must stay within the root-level `memory/` directory
- Do not create alternative memory locations
- Do not add files beyond the five defined above
- Every file must carry a complete, valid OKF frontmatter block at all times
- Keep memory clean and maintainable over time
