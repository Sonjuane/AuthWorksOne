<!-- AGENTS-MD:BEGIN — Managed by `arc-agents-md`. Do not edit inside this block; your changes here will be overwritten by `npx arc-agents-md update`. Put project-specific instructions BELOW the END marker or in .agents.md/project/. -->

# AGENTS.md — Developer Preferences

This is the **authoritative entry point** for AI agents working on this project.

**Read this file first. Then load ONLY the files relevant to your current task.**
Do not pre-load all reference files. Context must stay lean and focused.

---

## Task-Conditional File Loading

| If your task involves…                                                                                                                    | Load this file                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Writing, editing, or reviewing **code**                                                                                                   | [.agents.md/01-development-rules.md](.agents.md/01-development-rules.md)              |
| Creating, modifying, or organizing **documentation**                                                                                      | [.agents.md/02-documentation-rules.md](.agents.md/02-documentation-rules.md)         |
| Understanding developer **style, preferences, or philosophy**                                                                             | [.agents.md/03-developer-profile.md](.agents.md/03-developer-profile.md)             |
| Project has a `memory/` directory (LLM Wiki enabled)                                                                                       | [.agents.md/04-memory-wiki.md](.agents.md/04-memory-wiki.md)                          |
| Designing or reviewing **APIs, MCP servers, or tool interfaces**                                                                          | [.agents.md/05-schema-first-api-design.md](.agents.md/05-schema-first-api-design.md) |
| Working with **test scripts, prototypes, or experiments** (project has a `lab-ex/` directory, or user asks for a spike/sandbox/prototype) | [.agents.md/06-lab-experiments.md](.agents.md/06-lab-experiments.md)                 |
| **Anything specific to THIS project** (stack, conventions, domain rules)                                                                  | Any file in [.agents.md/project/](.agents.md/project/)                               |

---

## Always-On Rules (No File Load Required)

These apply to **every task** without exception:

- All rules in loaded files are **binding**. Interpretation or deviation is not permitted.
- If a rule is violated, **halt execution** and request clarification before proceeding.
- Do not produce partial, speculative, or non-compliant output.
- Do not create files, documentation, or abstractions beyond what the task requires.
- Prefer JavaScript. Avoid Python, PHP, or Bash unless explicitly required.

**Before coding:**

- State assumptions explicitly. If multiple interpretations exist, present them — do not pick silently.
- If something is unclear, stop and ask before implementing.

**Asking clarifying questions:**

- Use the interactive question tool (e.g. `AskUserQuestion`) to ask clarifying questions as multiple choice menus.
- Always allow an 'Other' option where the user can write a custom response.

**Simplicity:**

- Write the minimum code that solves the problem. Nothing speculative.
- No abstractions, features, or error handling beyond what was asked.
- If you wrote 200 lines and it could be 50, rewrite it.

**Surgical changes:**

- Touch only what the task requires. Do not improve adjacent code, formatting, or comments.
- Match existing style even if you would do it differently.
- Remove imports/variables/functions YOUR changes made unused. Leave pre-existing dead code alone unless asked.

**Execution:**

- For multi-step tasks, state a brief plan with verifiable success criteria before starting.
- Define what "done" looks like, then loop until verified.

---

## File Index

- [.agents.md/01-development-rules.md](.agents.md/01-development-rules.md) — Code standards, language preferences, schema-first approach, utility patterns
- [.agents.md/02-documentation-rules.md](.agents.md/02-documentation-rules.md) — Documentation structure, creation control, style enforcement, self-validation checklist
- [.agents.md/03-developer-profile.md](.agents.md/03-developer-profile.md) — Developer background, workflow preferences, project philosophy
- [.agents.md/04-memory-wiki.md](.agents.md/04-memory-wiki.md) — LLM Wiki rules (only applies when project has a `memory/` directory)
- [.agents.md/05-schema-first-api-design.md](.agents.md/05-schema-first-api-design.md) — Schema-first API design standard for MCP-compatible, AI-native APIs
- [.agents.md/06-lab-experiments.md](.agents.md/06-lab-experiments.md) — `lab-ex/` R&D sandbox convention for testing scripts and prototype components
- [.agents.md/project/](.agents.md/project/) — Project-specific rules and context (not managed by `agents-md`; safe across updates)

<!-- AGENTS-MD:END -->

<!-- Everything below this line is yours. `npx arc-agents-md update` will never touch it. -->
